import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { dbPool } from '../../../../../lib/iam-adapter';
import {
  CAPTURE_IDEMPOTENCY_HEADER,
  CAPTURE_SIGNATURE_HEADER,
  CAPTURE_TIMESTAMP_HEADER,
  MAX_CAPTURE_BODY_BYTES,
  captureLeadFields,
  validatedCapturePayload,
  verifyCaptureSignature,
  type CaptureIngressSource,
} from '../../../../../lib/lead-capture-ingress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requiredHeader(request: Request, name: string, max = 512): string {
  const value = request.headers.get(name)?.trim() ?? '';
  if (!value || value.length > max || /[\r\n\0]/u.test(value)) throw new Error(`${name.toUpperCase()}_REQUIRED`);
  return value;
}

/**
 * Public, source-bound Demand Capture ingress.
 *
 * tenantId/sourceId are routing coordinates, never authorization claims. The
 * source's persisted Ed25519 public key verifies the exact timestamp + raw body
 * before any Lead/submission mutation. Organization, layer and initial stage
 * are derived from the persisted source; external callers cannot choose them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const sourceId = decodeURIComponent((await params).sourceId).trim();
  const tenantId = new URL(request.url).searchParams.get('tenantId')?.trim() ?? '';
  if (!UUID.test(sourceId) || !UUID.test(tenantId)) {
    return NextResponse.json({ error: 'A valid tenantId and sourceId are required.' }, { status: 400 });
  }

  let signature: string;
  let timestamp: string;
  let idempotencyKey: string;
  try {
    signature = requiredHeader(request, CAPTURE_SIGNATURE_HEADER, 256);
    timestamp = requiredHeader(request, CAPTURE_TIMESTAMP_HEADER, 32);
    idempotencyKey = requiredHeader(request, CAPTURE_IDEMPOTENCY_HEADER, 200);
  } catch {
    return NextResponse.json({ error: 'Signed capture headers are required.' }, { status: 400 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_CAPTURE_BODY_BYTES) {
    return NextResponse.json({ error: 'Capture payload size is invalid.' }, { status: 413 });
  }

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.lead_capture_ingress_source_id', $1, true)", [sourceId]);

    const sourceResult = await client.query<{
      source_id: string;
      tenant_id: string;
      organization_id: string;
      source_key: string;
      layer_key: string | null;
      verification_algorithm: 'ED25519';
      verification_public_key: string | null;
      verification_key_id: string | null;
      max_clock_skew_seconds: number;
      require_signed_ticket: boolean;
      status: string;
    }>(
      `SELECT source_id, tenant_id, organization_id, source_key, layer_key,
              verification_algorithm, verification_public_key, verification_key_id,
              max_clock_skew_seconds, require_signed_ticket, status
         FROM platform.lead_capture_sources
        WHERE tenant_id = $1::uuid AND source_id = $2::uuid
        LIMIT 1`,
      [tenantId, sourceId],
    );
    const row = sourceResult.rows[0];
    if (!row || row.status !== 'ACTIVE' || row.require_signed_ticket !== true
        || row.verification_algorithm !== 'ED25519' || !row.verification_public_key || !row.verification_key_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Capture source is unavailable.' }, { status: 404 });
    }

    const source: CaptureIngressSource = {
      sourceId: row.source_id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      sourceKey: row.source_key,
      layerKey: row.layer_key,
      verificationAlgorithm: row.verification_algorithm,
      verificationPublicKey: row.verification_public_key,
      verificationKeyId: row.verification_key_id,
      maxClockSkewSeconds: row.max_clock_skew_seconds,
    };

    let verified = false;
    try {
      verified = verifyCaptureSignature({
        publicKeyPem: source.verificationPublicKey,
        signatureBase64: signature,
        timestamp,
        rawBody,
        maxClockSkewSeconds: source.maxClockSkewSeconds,
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Capture signature is invalid or expired.' }, { status: 401 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = validatedCapturePayload(JSON.parse(Buffer.from(rawBody).toString('utf8')));
    } catch {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Capture payload must be a JSON object.' }, { status: 400 });
    }

    // Serialize by source + idempotency key so concurrent replays cannot create
    // two capture Leads before the submission uniqueness constraint is observed.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(concat_ws(':', $1::uuid::text, $2::uuid::text, $3), 0))`,
      [tenantId, sourceId, idempotencyKey],
    );

    const existing = await client.query<{ capture_lead_id: string | null }>(
      `SELECT capture_lead_id
         FROM platform.lead_capture_submissions
        WHERE tenant_id = $1::uuid AND source_id = $2::uuid AND idempotency_key = $3
        LIMIT 1`,
      [tenantId, sourceId, idempotencyKey],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return NextResponse.json({
        accepted: true,
        replayed: true,
        captureLeadId: existing.rows[0].capture_lead_id,
      }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    const fields = captureLeadFields(payload);
    const captureLeadId = randomUUID();
    const submissionId = randomUUID();
    await client.query(
      `INSERT INTO platform.lead_capture_leads
         (capture_lead_id, tenant_id, organization_id, source_id, external_reference,
          title, email, stage, status, raw_payload)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7,
               'NEW_ENQUIRY', 'ACTIVE', $8::jsonb)`,
      [captureLeadId, tenantId, source.organizationId, sourceId, fields.externalReference,
       fields.title ?? `New enquiry from ${source.sourceKey}`, fields.email, JSON.stringify(payload)],
    );
    await client.query(
      `INSERT INTO platform.lead_capture_submissions
         (submission_id, tenant_id, organization_id, source_id, capture_lead_id, idempotency_key, raw_payload)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb)`,
      [submissionId, tenantId, source.organizationId, sourceId, captureLeadId, idempotencyKey, JSON.stringify(payload)],
    );

    await client.query('COMMIT');
    return NextResponse.json({ accepted: true, replayed: false, captureLeadId }, {
      status: 202,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json({ error: 'Capture external reference already exists.' }, { status: 409 });
    }
    console.error('Demand Capture ingress failed:', error);
    return NextResponse.json({ error: 'Capture could not be accepted.' }, { status: 500 });
  } finally {
    client.release();
  }
}
