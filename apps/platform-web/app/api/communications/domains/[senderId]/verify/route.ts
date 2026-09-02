import { NextResponse } from 'next/server';
import { promises as dns } from 'node:dns';
import { resolveRequestContext, withTenantTransaction, deniedResponse } from '../../../../../../lib/request-context';
import { expectedDnsRecords } from '../../../../../../lib/dns-records';
import { hasPlatformAdministrationRole } from '../../../../../../lib/governance-authz';
import { requireCommunicationDomainAdmin } from '../../../../../../lib/communication-domain-admin';

/**
 * DNS verification for an existing email sender identity. Mutation authority is
 * scope-aware: tenant senders require communication-domain administration and
 * platform senders require Platform Administration. Provider-issued DKIM is
 * still a separate evidence gap and is not fabricated by this boundary.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    if (!UUID_RE.test(senderId)) {
      return NextResponse.json({ error: 'senderId must be a valid UUID.' }, { status: 400 });
    }

    const outcome = await withTenantTransaction(context, async (client) => {
      const senderResult = await client.query<{
        sender_id: string;
        scope: 'PLATFORM' | 'TENANT';
        address: string;
      }>(
        `SELECT sender_id, scope, address
           FROM platform.communication_sender_identities
          WHERE sender_id = $1::uuid
            AND channel = 'email'
            AND (
              scope = 'PLATFORM'
              OR (scope = 'TENANT' AND tenant_id = $2::uuid)
            )
          LIMIT 1`,
        [senderId, context.tenantId],
      );
      const sender = senderResult.rows[0];
      if (sender === undefined) return { kind: 'NOT_FOUND' as const };

      if (sender.scope === 'PLATFORM') {
        if (!(await hasPlatformAdministrationRole(client, context.subjectId))) {
          return { kind: 'DENIED' as const, reasonKey: 'PLATFORM_ADMIN_REQUIRED' };
        }
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      } else if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return { kind: 'DENIED' as const, reasonKey: 'FORBIDDEN' };
      }

      const domain = sender.address.includes('@') ? sender.address.split('@')[1]! : sender.address;
      const verifiable = expectedDnsRecords(domain).filter((spec) => spec.verifiable);
      const checks = await Promise.all(verifiable.map(checkRecord));
      const allVerified = checks.length > 0 && checks.every((check) => check.ok);
      const nextStatus = allVerified ? 'VERIFIED' : 'PENDING';

      await client.query(
        `UPDATE platform.communication_sender_identities
            SET verification_status = $2, updated_at = now()
          WHERE sender_id = $1::uuid
            AND channel = 'email'
            AND (
              (scope = 'PLATFORM' AND $4::boolean = true)
              OR (scope = 'TENANT' AND tenant_id = $3::uuid)
            )`,
        [senderId, nextStatus, context.tenantId, sender.scope === 'PLATFORM'],
      );

      return { kind: 'OK' as const, domain, verificationStatus: nextStatus, checks };
    });

    if (outcome.kind === 'DENIED') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: outcome.reasonKey,
          message: outcome.reasonKey === 'PLATFORM_ADMIN_REQUIRED'
            ? 'Only Platform Administration can verify platform senders.'
            : 'Sending-domain administration is required.',
        },
        { status: 403 },
      );
    }
    if (outcome.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'That sending domain was not found.' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      domain: outcome.domain,
      verificationStatus: outcome.verificationStatus,
      checks: outcome.checks,
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
