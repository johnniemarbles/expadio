import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../lib/request-context";
import type { DeniedResult } from '@expadio/ui/contracts';

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
    status: 'VERIFIED' | 'PENDING';
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
         AND (scope = 'PLATFORM' OR tenant_id = $1::uuid)
       ORDER BY is_default DESC, created_at DESC`,
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) return NextResponse.json([]);
    const domains: DomainRecord[] = result.rows.map((row: any) => {
      const emailDomain = row.address.includes('@') ? row.address.split('@')[1] : row.address;
      const isVerified = row.verification_status === 'VERIFIED';
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
        dnsRecords: [
          { type: 'TXT', name: `resend._domainkey.${emailDomain}`, value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3', status: isVerified ? 'VERIFIED' : 'PENDING' },
          { type: 'TXT', name: emailDomain, value: 'v=spf1 include:amazonses.com include:_spf.resend.com ~all', status: isVerified ? 'VERIFIED' : 'PENDING' },
          { type: 'TXT', name: `_dmarc.${emailDomain}`, value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${emailDomain}`, status: isVerified ? 'VERIFIED' : 'PENDING' },
          { type: 'MX', name: `mail.${emailDomain}`, value: 'feedback-smtp.us-east-1.amazonses.com', status: isVerified ? 'VERIFIED' : 'PENDING' },
        ],
        createdAt: new Date(row.created_at).toISOString(),
      };
    });

    return NextResponse.json(domains);
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }

    console.error('Domains API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: 'An internal error occurred.' };
    return NextResponse.json(denied, { status: 500 });
  }
}

export async function POST(request: Request) {
  

  try {
    const effectiveContext = await resolveRequestContext(request);
    return await withTenantClient(effectiveContext, async (client) => {

    const body = await request.json();
    const { domain, address, displayName, isDefault } = body;
    const cleanAddress = address || `notifications@${domain}`;

    const insertResult = await client.query(
      `INSERT INTO platform.communication_sender_identities
         (tenant_id, organization_id, scope, channel, address, display_name, purposes, is_default, verification_status, status)
       VALUES
         ($1, NULL, 'TENANT', 'email', $2, $3, ARRAY['transactional','marketing','system'], $4, 'PENDING', 'ACTIVE')
       ON CONFLICT (tenant_id, channel, lower(address)) WHERE scope = 'TENANT'
       DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
       RETURNING sender_id, verification_status, status, created_at`,
      [effectiveContext.tenantId, cleanAddress, displayName || 'Platform Sender', Boolean(isDefault)]
    );

    return NextResponse.json({ success: true, sender: insertResult.rows[0] });
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }

    console.error('Create domain identity error:', err);
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: 'An internal error occurred.' }, { status: 500 });
  }
}
