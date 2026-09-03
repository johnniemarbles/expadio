import { NextResponse } from 'next/server';
import { CAPTURE_PUBLISHABLE_KEY_HEADER } from '@expadio/lead-capture';
import { dbPool } from '../../../../../../lib/iam-adapter';
import { evaluateOtpAttempt } from '../../../../../../lib/lead-capture-otp';
import {
  UUID_RE,
  checkKeyAndOrigin,
  corsHeaders,
  loadPublicSource,
  setPublicIngressContext,
} from '../../../../../../lib/lead-capture-public-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin, !!origin) });
}

/**
 * Complete the PUBLIC (Rail B) OTP gate. A correct code promotes the parked lead
 * UNVERIFIED -> VERIFIED (its only legal effect); wrong codes burn an attempt and
 * lock after the limit; expired or exhausted challenges are terminal.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const sourceId = decodeURIComponent((await params).sourceId).trim();
  const tenantId = new URL(request.url).searchParams.get('tenantId')?.trim() ?? '';
  const origin = request.headers.get('origin');
  const publishableKey = request.headers.get(CAPTURE_PUBLISHABLE_KEY_HEADER)?.trim() ?? null;

  if (!UUID_RE.test(sourceId) || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: 'A valid tenantId and sourceId are required.' }, { status: 400, headers: corsHeaders(origin, false) });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400, headers: corsHeaders(origin, false) });
  }
  const captureLeadId = typeof body.captureLeadId === 'string' ? body.captureLeadId.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!UUID_RE.test(captureLeadId) || !/^\d{6}$/u.test(code)) {
    return NextResponse.json({ error: 'A captureLeadId and 6-digit code are required.' }, { status: 400, headers: corsHeaders(origin, false) });
  }

  const client = await dbPool.connect();
  try {
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
      return NextResponse.json({ error: gate.error }, { status: gate.status, headers: corsHeaders(origin, false) });
    }

    // Lock the latest challenge for this lead so concurrent verifies serialize.
    const challenge = await client.query<{
      verification_id: string; status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'LOCKED';
      attempts: number; max_attempts: number; code_hash: string; code_salt: string; expires_at: string;
    }>(
      `SELECT verification_id, status, attempts, max_attempts, code_hash, code_salt, expires_at
         FROM platform.lead_capture_verifications
        WHERE tenant_id=$1::uuid AND source_id=$2::uuid AND capture_lead_id=$3::uuid
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [tenantId, sourceId, captureLeadId],
    );
    const row = challenge.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'No verification is pending for this capture.' }, { status: 404, headers: corsHeaders(origin, true) });
    }

    const result = evaluateOtpAttempt({
      status: row.status,
      expiresAt: new Date(row.expires_at),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      suppliedCode: code,
      salt: row.code_salt,
      codeHash: row.code_hash,
    });

    if (result.outcome === 'VERIFIED' || result.outcome === 'ALREADY_VERIFIED') {
      if (result.outcome === 'VERIFIED') {
        await client.query(
          `UPDATE platform.lead_capture_verifications
              SET status='VERIFIED', verified_at=now(), updated_at=now()
            WHERE verification_id=$1::uuid`,
          [row.verification_id],
        );
        await client.query(
          `UPDATE platform.lead_capture_leads
              SET verification_state='VERIFIED', updated_at=now()
            WHERE capture_lead_id=$1::uuid AND verification_state='UNVERIFIED'`,
          [captureLeadId],
        );
      }
      await client.query('COMMIT');
      return NextResponse.json({ verified: true, captureLeadId }, { status: 200, headers: corsHeaders(origin, true) });
    }

    if (result.outcome === 'EXPIRED') {
      await client.query(`UPDATE platform.lead_capture_verifications SET status='EXPIRED', updated_at=now() WHERE verification_id=$1::uuid`, [row.verification_id]);
      await client.query('COMMIT');
      return NextResponse.json({ verified: false, reason: 'EXPIRED' }, { status: 410, headers: corsHeaders(origin, true) });
    }

    if (result.outcome === 'LOCKED') {
      await client.query(`UPDATE platform.lead_capture_verifications SET status='LOCKED', updated_at=now() WHERE verification_id=$1::uuid`, [row.verification_id]);
      await client.query('COMMIT');
      return NextResponse.json({ verified: false, reason: 'LOCKED' }, { status: 429, headers: corsHeaders(origin, true) });
    }

    // INVALID: burn an attempt, lock if that was the last.
    await client.query(
      `UPDATE platform.lead_capture_verifications
          SET attempts=$2, status=$3, updated_at=now()
        WHERE verification_id=$1::uuid`,
      [row.verification_id, result.attemptsAfter, result.lock ? 'LOCKED' : 'PENDING'],
    );
    await client.query('COMMIT');
    return NextResponse.json(
      { verified: false, reason: result.lock ? 'LOCKED' : 'INVALID', remainingAttempts: Math.max(0, row.max_attempts - result.attemptsAfter) },
      { status: result.lock ? 429 : 401, headers: corsHeaders(origin, true) },
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Public Demand Capture verify failed:', error);
    return NextResponse.json({ error: 'Verification could not be processed.' }, { status: 500, headers: corsHeaders(origin, false) });
  } finally {
    client.release();
  }
}
