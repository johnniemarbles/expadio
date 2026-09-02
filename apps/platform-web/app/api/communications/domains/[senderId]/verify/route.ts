import { NextResponse } from 'next/server';
import { promises as dns } from 'node:dns';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { expectedDnsRecords } from '../../../../../../lib/dns-records';

/**
 * Real domain verification (design: no fabricated VERIFIED).
 *
 * Resolves the expected SPF, DMARC and return-path MX records against live DNS.
 * The domain is marked VERIFIED only when every verifiable requirement is
 * actually present with the required value. DKIM is provider-issued and is not
 * included in DNS observations until provider evidence is available.
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

type DnsSpec = ReturnType<typeof expectedDnsRecords>[number];

function normalizeTxt(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function requiredTokens(value: string) {
  return normalizeTxt(value).split(' ').filter(Boolean);
}

function normalizeHost(value: string) {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

async function checkRecord(spec: DnsSpec): Promise<RecordCheck> {
  const base = { purpose: spec.purpose, type: spec.type, name: spec.name };
  try {
    if (spec.purpose === 'SPF') {
      const txt = (await dns.resolveTxt(spec.name)).map((chunks) => chunks.join(''));
      const candidates = txt.filter((record) => normalizeTxt(record).startsWith('v=spf1'));
      const required = requiredTokens(spec.value);
      const found = candidates.find((record) => {
        const tokens = new Set(requiredTokens(record));
        return required.every((token) => tokens.has(token));
      });
      return {
        ...base,
        ok: found !== undefined,
        detail: found ?? (candidates.length > 0
          ? `SPF exists but does not contain the required policy: ${spec.value}`
          : 'No v=spf1 TXT record found.'),
      };
    }

    if (spec.purpose === 'DMARC') {
      const txt = (await dns.resolveTxt(spec.name)).map((chunks) => chunks.join(''));
      const candidates = txt.filter((record) => normalizeTxt(record).startsWith('v=dmarc1'));
      const requiredDirectives = spec.value
        .split(';')
        .map((directive) => normalizeTxt(directive))
        .filter(Boolean);
      const found = candidates.find((record) => {
        const directives = new Set(record.split(';').map((directive) => normalizeTxt(directive)).filter(Boolean));
        return requiredDirectives.every((directive) => directives.has(directive));
      });
      return {
        ...base,
        ok: found !== undefined,
        detail: found ?? (candidates.length > 0
          ? `DMARC exists but does not contain the required policy: ${spec.value}`
          : 'No v=DMARC1 TXT record found.'),
      };
    }

    if (spec.purpose === 'Return-path (MX)') {
      const mx = await dns.resolveMx(spec.name);
      const requiredExchange = normalizeHost(spec.value);
      const found = mx.find((record) =>
        normalizeHost(record.exchange) === requiredExchange
        && (spec.priority === undefined || record.priority === spec.priority),
      );
      return {
        ...base,
        ok: found !== undefined,
        detail: found
          ? `${found.priority} ${found.exchange}`
          : (mx.length > 0
            ? `MX exists but required ${spec.priority ?? ''} ${spec.value}`.trim()
            : 'No MX records found.'),
      };
    }

    return { ...base, ok: false, detail: 'Unsupported DNS requirement.' };
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

      const verifiable = expectedDnsRecords(domain).filter((spec) => spec.verifiable);
      const checks = await Promise.all(verifiable.map(checkRecord));
      const allVerified = checks.length > 0 && checks.every((check) => check.ok);

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
