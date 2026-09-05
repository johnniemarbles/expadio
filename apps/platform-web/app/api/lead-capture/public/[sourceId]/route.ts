import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  CAPTURE_IDEMPOTENCY_HEADER,
  CAPTURE_PUBLISHABLE_KEY_HEADER,
  CaptureContractError,
  MAX_CAPTURE_BODY_BYTES,
  captureSubmissionAllowedBySourceConfig,
  extractLeadFields,
  normalizeSubmission,
  type CaptureSubmission,
} from '@expadio/lead-capture';
import { dbPool } from '../../../../../lib/iam-adapter';
import {
  RATE_WINDOW_SECONDS,
  clientIpFromForwardedFor,
  evaluateRateLimit,
} from '../../../../../lib/lead-capture-public-guard';
import { generateOtpCode, hashOtp, hashToken, newOtpSalt, otpExpiry, OTP_MAX_ATTEMPTS } from '../../../../../lib/lead-capture-otp';
import { deliverCaptureOtp } from '../../../../../lib/lead-capture-otp-delivery';
import { resolveOrCreateLeadContact } from '../../../../../lib/lead-contact-resolution';
import { persistCaptureAttributionAndConsent } from '../../../../../lib/lead-attribution';
import {
  UUID_RE,
  checkKeyAndOrigin,
  corsHeaders,
  loadPublicSource,
  setPublicIngressContext,
} from '../../../../../lib/lead-capture-public-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function coordinates(request: Request, sourceIdRaw: string) {
  const sourceId = decodeURIComponent(sourceIdRaw).trim();
  const tenantId = new URL(request.url).searchParams.get('tenantId')?.trim() ?? '';
  const origin = request.headers.get('origin');
  const publishableKey = request.headers.get(CAPTURE_PUBLISHABLE_KEY_HEADER)?.trim() ?? null;
  return { sourceId, tenantId, origin, publishableKey };
}

/** CORS preflight. Answer only for a real PUBLIC source whose allowlist includes
 *  the Origin — otherwise the browser blocks the cross-site POST anyway. */
export async function OPTIONS(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId, tenantId, origin, publishableKey } = coordinates(request, (await params).sourceId);
  if (!UUID_RE.test(sourceId) || !UUID_RE.test(tenantId) || !origin) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin, false) });
  }
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await setPublicIngressContext(client, tenantId, sourceId);
    const source = await loadPublicSource(client, tenantId, sourceId);
    await client.query('ROLLBACK');
    const allowed = !!source && checkKeyAndOrigin(source, publishableKey ?? source.publishable_key, origin).ok;
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin, allowed) });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin, false) });
  } finally {
    client.release();
  }
}

/**
 * PUBLIC (Rail B) capture ingress. No signature: admitted by publishable key +
 * origin allowlist + rate limit, captured first, and PARKED as UNVERIFIED so it
 * never reaches the pipeline until an OTP challenge is passed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId, tenantId, origin, publishableKey } = coordinates(request, (await params).sourceId);
  const idempotencyKey = request.headers.get(CAPTURE_IDEMPOTENCY_HEADER)?.trim() ?? '';

  if (!UUID_RE.test(sourceId) || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: 'A valid tenantId and sourceId are required.' }, { status: 400, headers: corsHeaders(origin, false) });
  }
  if (!idempotencyKey || idempotencyKey.length > 200 || /[\r\n\0]/u.test(idempotencyKey)) {
    return NextResponse.json({ error: 'An idempotency key is required.' }, { status: 400, headers: corsHeaders(origin, false) });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_CAPTURE_BODY_BYTES) {
    return NextResponse.json({ error: 'Capture payload size is invalid.' }, { status: 413, headers: corsHeaders(origin, false) });
  }

  const client = await dbPool.connect();
  try {
    // Phase A — validate the source, then record + evaluate rate limits in a
    // committed transaction so throttling survives even when this attempt is
    // rejected (a rolled-back attempt must still count against the window).
    await client.query('BEGIN');
    await setPublicIngressContext(client, tenantId, sourceId);
    const source = await loadPublicSource(client, tenantId, sourceId);
    if (!source) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Capture source is unavailable.' }, { status: 404, headers: corsHeaders(origin, false) });
    }
    const gate = checkKeyAndOrigin(source, publishableKey, origin);
    if (!gate.ok) {
      await client.query('ROLLBACK');
      // Do not echo Access-Control-Allow-Origin for an unvalidated key/origin.
      return NextResponse.json({ error: gate.error }, { status: gate.status, headers: corsHeaders(origin, false) });
    }

    let submission: CaptureSubmission;
    try {
      submission = normalizeSubmission(JSON.parse(Buffer.from(rawBody).toString('utf8')));
    } catch (error) {
      await client.query('ROLLBACK');
      const message = error instanceof CaptureContractError ? error.message : 'Capture payload is invalid.';
      return NextResponse.json({ error: message }, { status: 400, headers: corsHeaders(origin, true) });
    }
    const submittedInterest = submission.interest
      ? {
          interestType: submission.interest.interestType,
          ...('opportunityType' in submission.interest && submission.interest.opportunityType
            ? { opportunityType: submission.interest.opportunityType }
            : {}),
        }
      : undefined;
    if (!captureSubmissionAllowedBySourceConfig(source.publication_config, submittedInterest)) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Submission interest is not allowed by this capture source.', reasonKey: 'CAPTURE_SOURCE_INTEREST_NOT_ALLOWED' },
        { status: 400, headers: corsHeaders(origin, true) },
      );
    }
    const email = submission.contact.email;
    const emailHash = hashToken(email);
    const ip = clientIpFromForwardedFor(request.headers.get('x-forwarded-for'));
    const ipHash = ip ? hashToken(ip) : null;

    if (ipHash) {
      await client.query(
        `INSERT INTO platform.lead_capture_rate_events (tenant_id, organization_id, source_id, dimension, key_hash)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'IP', $4)`,
        [tenantId, source.organization_id, sourceId, ipHash],
      );
    }
    await client.query(
      `INSERT INTO platform.lead_capture_rate_events (tenant_id, organization_id, source_id, dimension, key_hash)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'EMAIL', $4)`,
      [tenantId, source.organization_id, sourceId, emailHash],
    );
    const counts = await client.query<{ ip_count: string; email_count: string }>(
      `SELECT
         (SELECT count(*) FROM platform.lead_capture_rate_events
           WHERE tenant_id=$1::uuid AND source_id=$2::uuid AND dimension='IP' AND key_hash=$3::text
             AND created_at > now() - make_interval(secs => $5::float8)) AS ip_count,
         (SELECT count(*) FROM platform.lead_capture_rate_events
           WHERE tenant_id=$1::uuid AND source_id=$2::uuid AND dimension='EMAIL' AND key_hash=$4::text
             AND created_at > now() - make_interval(secs => $5::float8)) AS email_count`,
      [tenantId, sourceId, ipHash ?? '', emailHash, RATE_WINDOW_SECONDS],
    );
    await client.query('COMMIT');

    const rate = evaluateRateLimit({
      ipCount: Number(counts.rows[0]?.ip_count ?? 0),
      emailCount: Number(counts.rows[0]?.email_count ?? 0),
    });
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Too many capture attempts. Please try again later.' }, { status: 429, headers: corsHeaders(origin, true) });
    }

    // Phase B — capture-first + park + OTP challenge, serialized per idempotency
    // key so concurrent replays cannot create two capture leads.
    await client.query('BEGIN');
    await setPublicIngressContext(client, tenantId, sourceId);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(concat_ws(':', $1::uuid::text, $2::uuid::text, $3::text), 0))`,
      [tenantId, sourceId, idempotencyKey],
    );
    const existing = await client.query<{ capture_lead_id: string | null }>(
      `SELECT capture_lead_id FROM platform.lead_capture_submissions
        WHERE tenant_id=$1::uuid AND source_id=$2::uuid AND idempotency_key=$3::text LIMIT 1`,
      [tenantId, sourceId, idempotencyKey],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return NextResponse.json(
        { accepted: true, replayed: true, captureLeadId: existing.rows[0].capture_lead_id, requiresVerification: true },
        { status: 200, headers: corsHeaders(origin, true) },
      );
    }

    const fields = extractLeadFields(submission);
    const captureLeadId = randomUUID();
    const rawPayloadJson = JSON.stringify(submission);

    // Gate 1: resolve the person (exact-email auto-link) + enqueue review
    // candidates. Best-effort — never fail the capture over identity work.
    let contactId: string | null = null;
    try {
      const resolved = await resolveOrCreateLeadContact(client, {
        tenantId,
        organizationId: source.organization_id,
        email,
        phone: submission.contact.phone ?? null,
        firstName: submission.contact.firstName ?? null,
        lastName: submission.contact.lastName ?? null,
      });
      contactId = resolved.contactId;
    } catch (error) {
      console.warn(`Capture contact resolution skipped for ${captureLeadId}:`, error instanceof Error ? error.message : error);
    }

    await client.query(
      `INSERT INTO platform.lead_capture_leads
         (capture_lead_id, tenant_id, organization_id, source_id, external_reference,
          title, email, stage, status, verification_state, raw_payload, contact_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,'NEW_ENQUIRY','ACTIVE','UNVERIFIED',$8::jsonb,$9::uuid)`,
      [captureLeadId, tenantId, source.organization_id, sourceId, fields.externalReference ?? null,
       fields.title, email, rawPayloadJson, contactId],
    );
    await client.query(
      `INSERT INTO platform.lead_capture_submissions
         (submission_id, tenant_id, organization_id, source_id, capture_lead_id, idempotency_key, raw_payload)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::jsonb)`,
      [randomUUID(), tenantId, source.organization_id, sourceId, captureLeadId, idempotencyKey, rawPayloadJson],
    );

    const code = generateOtpCode();
    const salt = newOtpSalt();
    await client.query(
      `INSERT INTO platform.lead_capture_verifications
         (tenant_id, organization_id, source_id, capture_lead_id, channel, destination_hash,
          code_hash, code_salt, max_attempts, expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'EMAIL',$5,$6,$7,$8,$9)`,
      [tenantId, source.organization_id, sourceId, captureLeadId, emailHash,
       hashOtp(code, salt), salt, OTP_MAX_ATTEMPTS, otpExpiry().toISOString()],
    );

    // Gate 2: durable attribution + consent evidence. Best-effort.
    try {
      await persistCaptureAttributionAndConsent(client, {
        tenantId,
        organizationId: source.organization_id,
        captureLeadId,
        contactId,
        sourceKey: source.source_key,
        attribution: submission.attribution,
        consent: submission.consent,
      });
    } catch (error) {
      console.warn(`Capture attribution persistence skipped for ${captureLeadId}:`, error instanceof Error ? error.message : error);
    }

    // Gate 3: open the activity timeline with a system "captured" entry.
    try {
      await client.query(
        `INSERT INTO platform.lead_activities
           (tenant_id, organization_id, capture_lead_id, contact_id, activity_type, body, metadata)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'SYSTEM',$5,$6::jsonb)`,
        [tenantId, source.organization_id, captureLeadId, contactId,
         `Captured via ${source.source_key}`, JSON.stringify({ sourceKey: source.source_key, channel: 'WEB' })],
      );
    } catch (error) {
      console.warn(`Capture activity log skipped for ${captureLeadId}:`, error instanceof Error ? error.message : error);
    }

    await client.query('COMMIT');

    await deliverCaptureOtp({
      tenantId, organizationId: source.organization_id, captureLeadId, channel: 'EMAIL', code, destination: email,
    });

    return NextResponse.json(
      { accepted: true, replayed: false, captureLeadId, requiresVerification: true },
      { status: 202, headers: corsHeaders(origin, true) },
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Capture external reference already exists.' }, { status: 409, headers: corsHeaders(origin, true) });
    }
    console.error('Public Demand Capture ingress failed:', error);
    return NextResponse.json({ error: 'Capture could not be accepted.' }, { status: 500, headers: corsHeaders(origin, true) });
  } finally {
    client.release();
  }
}
