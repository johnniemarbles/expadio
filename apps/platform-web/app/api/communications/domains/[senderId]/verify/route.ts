import { NextResponse } from 'next/server';
import { promises as dns } from 'node:dns';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { expectedDnsRecords } from '../../../../../../lib/dns-records';

/**
 * Real domain verification (design: no fabricated VERIFIED).
 *
 * Resolves the expected SPF, DMARC and return-path MX records against live DNS.
 * The domain is marked VERIFIED only when every verifiable record actually
 * resolves; otherwise it stays PENDING and we report which records are missing.
 * DKIM is issued by the sending provider, so it is reported informationally,
 * never asserted as passing.
 *
 * DNS resolution needs egress. Where egress is restricted the checks fail
 * closed — PENDING, with the resolver error surfaced — which is the honest
 * outcome, not a green tick.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RecordCheck {
  purpose: string;
  type: string;
  name: string;
  ok: boolean;
  detail: string;
}

async function checkRecord(spec: ReturnType<typeof expectedDnsRecords>[number]): Promise<RecordCheck> {
  const base = { purpose: spec.purpose, type: spec.type, name: spec.name };
  try {
    if (spec.purpose === 'SPF') {
      const domain = spec.name;
      const txt = (await dns.resolveTxt(domain)).map((chunks) => chunks.join(''));
      const found = txt.find((r) => r.toLowerCase().startsWith('v=spf1'));
      return { ...base, ok: found !== undefined, detail: found ?? 'No v=spf1 TXT record found.' };
    }
    if (spec.purpose === 'DMARC') {
      const txt = (await dns.resolveTxt(spec.name)).map((chunks) => chunks.join(''));
      const found = txt.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
      return { ...base, ok: found !== undefined, detail: found ?? 'No v=DMARC1 TXT record found.' };
    }
    if (spec.purpose === 'Return-path (MX)') {
      const domain = spec.name.replace(/^mail\./, '');
      const mx = await dns.resolveMx(domain).catch(() => dns.resolveMx(spec.name));
      return {
        ...base,
        ok: mx.length > 0,
        detail: mx.length > 0 ? mx.map((m) => `${m.priority} ${m.exchange}`).join(', ') : 'No MX records found.',
      };
    }
    return { ...base, ok: false, detail: 'Not a verifiable record.' };
  } catch (error) {
    return { ...base, ok: false, detail: (error as Error).message };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ senderId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const senderId = decodeURIComponent((await params).senderId);

    const result = await withTenantClient(context, async (client) => {
      const sender = await client.query(
        `SELECT sender_id, address, verification_status
           FROM platform.communication_sender_identities
          WHERE sender_id = $1::uuid
            AND (scope = 'PLATFORM' OR tenant_id = $2::uuid)`,
        [senderId, context.tenantId],
      );
      if (sender.rows.length === 0) return null;

      const address: string = sender.rows[0].address;
      const domain = address.includes('@') ? address.split('@')[1] : address;

      const specs = expectedDnsRecords(domain);
      const verifiable = specs.filter((s) => s.verifiable);
      const checks = await Promise.all(specs.map(checkRecord));
      const verifiableChecks = checks.filter((c) => verifiable.some((s) => s.purpose === c.purpose));
      const allVerified = verifiableChecks.length > 0 && verifiableChecks.every((c) => c.ok);

      const nextStatus = allVerified ? 'VERIFIED' : 'PENDING';
      await client.query(
        `UPDATE platform.communication_sender_identities
            SET verification_status = $2, updated_at = now()
          WHERE sender_id = $1::uuid`,
        [senderId, nextStatus],
      );

      return { domain, verificationStatus: nextStatus, checks };
    });

    if (result === null) {
      return NextResponse.json({ error: 'That sending domain was not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
