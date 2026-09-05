import { promises as dns } from 'node:dns';
import { NextResponse } from 'next/server';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../lib/brand-context';
import { resolveGovernedResendToken } from '../../../../../../lib/governed-resend-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTxt(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function checkSpf(domain: string): Promise<boolean> {
  try {
    const records = (await dns.resolveTxt(domain)).map((chunks) => chunks.join(''));
    const spfRecords = records.filter((r) => normalizeTxt(r).startsWith('v=spf1'));
    return spfRecords.some((r) => normalizeTxt(r).includes('include:_spf.resend.com'));
  } catch {
    return false;
  }
}

async function checkDmarc(domain: string): Promise<boolean> {
  try {
    const records = (await dns.resolveTxt(`_dmarc.${domain}`)).map((chunks) => chunks.join(''));
    return records.some((r) => normalizeTxt(r).startsWith('v=dmarc1'));
  } catch {
    return false;
  }
}

async function checkResendDomain(token: string, domain: string): Promise<{
  ok: boolean;
  status: string | null;
  sendingEnabled: boolean;
}> {
  try {
    const response = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { ok: false, status: null, sendingEnabled: false };
    const body = await response.json().catch(() => null) as {
      data?: Array<{ name?: unknown; status?: unknown; capabilities?: { sending?: unknown } }>;
    } | null;
    const match = (body?.data ?? []).find(
      (d) => typeof d.name === 'string' && d.name.trim().toLowerCase() === domain,
    );
    if (match === undefined) return { ok: false, status: null, sendingEnabled: false };
    const status = typeof match.status === 'string' ? match.status.trim().toLowerCase() : null;
    const sendingCapability = typeof match.capabilities?.sending === 'string'
      ? match.capabilities.sending.trim().toLowerCase()
      : null;
    const sendingEnabled = sendingCapability !== null ? sendingCapability === 'enabled' : status === 'verified';
    return { ok: sendingEnabled, status, sendingEnabled };
  } catch {
    return { ok: false, status: null, sendingEnabled: false };
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ senderId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const senderId = decodeURIComponent((await params).senderId).trim();
    if (!UUID_RE.test(senderId)) {
      return NextResponse.json({ error: 'senderId must be a valid UUID.' }, { status: 400 });
    }

    const requestedAt = new Date().toISOString();

    // Load the sender record and resolve Resend token inside a single transaction.
    const prepared = await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return { kind: 'FORBIDDEN' as const };
      }

      const senderResult = await client.query(
        `SELECT sender_id, address, verification_status, status
           FROM platform.communication_sender_identities
          WHERE sender_id = $1::uuid
            AND tenant_id = $2::uuid
            AND organization_id = $3::uuid
            AND scope = 'ORGANIZATION'
            AND channel = 'email'
          LIMIT 1`,
        [senderId, context.tenantId, context.organizationId],
      );
      const row = senderResult.rows[0];
      if (row === undefined) return { kind: 'NOT_FOUND' as const };
      if (row.status !== 'ACTIVE') return { kind: 'INACTIVE' as const };

      let resendToken: string | null = null;
      try {
        const governed = await resolveGovernedResendToken(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          subjectId: context.subjectId,
          domain: String(row.address).split('@')[1] ?? String(row.address),
          requestedAt,
        });
        resendToken = governed?.token ?? null;
      } catch {
        // Token unavailable — DNS-only check will proceed
      }

      return {
        kind: 'FOUND' as const,
        address: String(row.address),
        currentStatus: String(row.verification_status),
        resendToken,
      };
    });

    if (prepared.kind === 'FORBIDDEN') {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' },
        { status: 403 },
      );
    }
    if (prepared.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Organization sender not found.' }, { status: 404 });
    }
    if (prepared.kind === 'INACTIVE') {
      return NextResponse.json({ error: 'Sender is not active.' }, { status: 409 });
    }

    const domain = (prepared.address.includes('@')
      ? prepared.address.split('@')[1]
      : prepared.address
    ).trim().toLowerCase();

    // Run DNS checks in parallel.
    const [spfOk, dmarcOk] = await Promise.all([checkSpf(domain), checkDmarc(domain)]);
    const dnsVerified = spfOk && dmarcOk;

    // Check Resend provider if DNS is verified and a token is available.
    let providerOk = false;
    let providerStatus: string | null = null;
    let providerChecked = false;

    if (dnsVerified && prepared.resendToken !== null) {
      const providerResult = await checkResendDomain(prepared.resendToken, domain);
      providerOk = providerResult.ok;
      providerStatus = providerResult.status;
      providerChecked = true;
    }

    // Require both DNS and provider (when provider is available) for full VERIFIED status.
    // Allow DNS-only verification when no Resend connector is configured.
    const fullyVerified = dnsVerified && (providerChecked ? providerOk : true);
    const nextStatus = fullyVerified ? 'VERIFIED' : 'PENDING';

    await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return;
      }

      await client.query(
        `UPDATE platform.communication_sender_identities
            SET verification_status = $2, updated_at = now()
          WHERE sender_id = $1::uuid
            AND tenant_id = $3::uuid
            AND organization_id = $4::uuid
            AND scope = 'ORGANIZATION'`,
        [senderId, nextStatus, context.tenantId, context.organizationId],
      );

      // Auto-promote to default when verified and no active default exists.
      if (nextStatus === 'VERIFIED') {
        const defaultExists = await client.query(
          `SELECT 1
             FROM platform.communication_sender_identities
            WHERE tenant_id = $1::uuid
              AND organization_id = $2::uuid
              AND scope = 'ORGANIZATION'
              AND channel = 'email'
              AND is_default = true
              AND status = 'ACTIVE'
              AND verification_status = 'VERIFIED'
              AND sender_id <> $3::uuid
            LIMIT 1`,
          [context.tenantId, context.organizationId, senderId],
        );
        if (defaultExists.rows.length === 0) {
          await client.query(
            `UPDATE platform.communication_sender_identities
                SET is_default = true, updated_at = now()
              WHERE sender_id = $1::uuid
                AND tenant_id = $2::uuid
                AND organization_id = $3::uuid
                AND scope = 'ORGANIZATION'`,
            [senderId, context.tenantId, context.organizationId],
          );
        }
      }
    });

    return NextResponse.json({
      success: true,
      domain,
      dnsVerified,
      spfOk,
      dmarcOk,
      providerChecked,
      providerOk,
      providerStatus,
      verificationStatus: nextStatus,
      autoPromoted: nextStatus === 'VERIFIED',
    });
  } catch (error) {
    console.error('Brand sender verification failed:', error);
    return NextResponse.json({ error: 'Verification could not be completed.' }, { status: 500 });
  }
}
