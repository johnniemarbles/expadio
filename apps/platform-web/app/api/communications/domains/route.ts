import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../lib/request-context";
import { expectedDnsRecords } from "../../../../lib/dns-records";
import { requireCommunicationDomainAdmin } from "../../../../lib/communication-domain-admin";
import type { DeniedResult } from '@expadio/ui/contracts';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ADDRESS_RE = /^[^\s@]+@([^\s@]+)$/;
const TENANT_PURPOSES = ['transactional', 'marketing'] as const;

type TenantPurpose = (typeof TENANT_PURPOSES)[number];

export interface DomainRecord {
  senderId: string;
  domain: string;
  address: string;
  displayName: string | null;
  channel: string;
  scope: string;
  purposes: string[];
  isDefault: boolean;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED' | 'REVOKED';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  dnsRecords: {
    type: string;
    name: string;
    value: string;
    purpose: string;
    verifiable: boolean;
  }[];
  createdAt: string;
}

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    return await withTenantClient(effectiveContext, async (client) => {
      const result = await client.query(
        `SELECT
           sender_id,
           scope,
           channel,
           address,
           display_name,
           reply_to,
           purposes,
           is_default,
           verification_status,
           status,
           created_at
         FROM platform.communication_sender_identities
         WHERE channel = 'email'
           AND tenant_id = $1::uuid
           AND scope IN ('TENANT', 'ORGANIZATION')
         ORDER BY is_default DESC, created_at DESC`,
        [effectiveContext.tenantId]
      );

      if (result.rows.length === 0) return NextResponse.json([]);
      const domains: DomainRecord[] = result.rows.map((row: any) => {
        const emailDomain = row.address.includes('@') ? row.address.split('@')[1] : row.address;
        return {
          senderId: row.sender_id,
          domain: emailDomain,
          address: row.address,
          displayName: row.display_name,
          channel: row.channel,
          scope: row.scope,
          purposes: row.purposes,
          isDefault: row.is_default,
          verificationStatus: row.verification_status,
          status: row.status,
          dnsRecords: expectedDnsRecords(emailDomain).map((record) => ({
            type: record.type,
            name: record.name,
            value: record.value,
            purpose: record.purpose,
            verifiable: record.verifiable,
          })),
          createdAt: new Date(row.created_at).toISOString(),
        };
      });

      return NextResponse.json(domains);
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }

    console.error('Domains API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message };
    return NextResponse.json(denied, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    const body = await request.json();
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
    const displayName = typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120)
      : 'Tenant Sender';
    const isDefault = body.isDefault === true;
    const requestedPurposes = Array.isArray(body.purposes)
      ? body.purposes.filter((value: unknown): value is TenantPurpose => typeof value === 'string' && TENANT_PURPOSES.includes(value as TenantPurpose))
      : ['transactional'] satisfies TenantPurpose[];
    const purposes = [...new Set<TenantPurpose>(requestedPurposes)];

    if (!DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: 'A valid sending domain is required.' }, { status: 400 });
    }
    if (purposes.length === 0) {
      return NextResponse.json({ error: 'At least one supported sender purpose is required.' }, { status: 400 });
    }

    const rawAddress = typeof body.address === 'string' && body.address.trim()
      ? body.address.trim().toLowerCase()
      : `notifications@${domain}`;
    const addressMatch = ADDRESS_RE.exec(rawAddress);
    if (!addressMatch || addressMatch[1]?.toLowerCase() !== domain) {
      return NextResponse.json({ error: 'Sender address must be a valid address on the submitted domain.' }, { status: 400 });
    }

    return await withTenantClient(effectiveContext, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, effectiveContext.subjectId, effectiveContext.tenantId))) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' }, { status: 403 });
      }

      const existing = await client.query<{ status: string }>(
        `SELECT status
           FROM platform.communication_sender_identities
          WHERE tenant_id = $1::uuid
            AND scope = 'TENANT'
            AND channel = 'email'
            AND lower(address) = lower($2)
          LIMIT 1`,
        [effectiveContext.tenantId, rawAddress],
      );
      if (existing.rows[0]?.status === 'SUSPENDED') {
        return NextResponse.json(
          { error: 'This sender is suspended and can only be restored through Platform governance.' },
          { status: 409 },
        );
      }

      await client.query('BEGIN');
      try {
        if (isDefault) {
          await client.query(
            `UPDATE platform.communication_sender_identities
                SET is_default = false, updated_at = now()
              WHERE tenant_id = $1::uuid
                AND scope = 'TENANT'
                AND channel = 'email'
                AND is_default = true
                AND status = 'ACTIVE'`,
            [effectiveContext.tenantId],
          );
        }

        const insertResult = await client.query(
          `INSERT INTO platform.communication_sender_identities
             (tenant_id, organization_id, scope, channel, address, display_name, purposes, is_default, verification_status, status)
           VALUES
             ($1, NULL, 'TENANT', 'email', $2, $3, $4::text[], $5, 'PENDING', 'ACTIVE')
           ON CONFLICT (tenant_id, channel, lower(address)) WHERE scope = 'TENANT'
           DO UPDATE SET
             display_name = EXCLUDED.display_name,
             purposes = EXCLUDED.purposes,
             is_default = EXCLUDED.is_default,
             verification_status = platform.communication_sender_identities.verification_status,
             status = CASE
               WHEN platform.communication_sender_identities.status = 'INACTIVE' THEN 'ACTIVE'
               ELSE platform.communication_sender_identities.status
             END,
             updated_at = NOW()
           RETURNING sender_id, address, purposes, is_default, verification_status, status, created_at`,
          [effectiveContext.tenantId, rawAddress, displayName, purposes, isDefault]
        );
        await client.query('COMMIT');
        return NextResponse.json({ success: true, sender: insertResult.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }

    console.error('Create domain identity error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
