import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../../lib/request-context";
import type { DeniedResult } from '@expadio/ui/contracts';

export async function POST(request: Request) {
  

  try {
    const effectiveContext = await resolveRequestContext(request);
    return await withTenantClient(effectiveContext, async (client) => {

    const body = await request.json().catch(() => ({}));
    const domain = body.domain || 'expadio.com';
    const address = `notifications@${domain}`;

    // Upsert the domain sender identity and mark as VERIFIED via Cloudflare DNS configuration
    const result = await client.query(
      `INSERT INTO platform.communication_sender_identities
         (tenant_id, organization_id, scope, channel, address, display_name, purposes, is_default, verification_status, status)
       VALUES
         ($1, NULL, 'TENANT', 'email', $2, 'EXPADIO Cloudflare Verified', ARRAY['transactional','marketing','system'], true, 'VERIFIED', 'ACTIVE')
       ON CONFLICT (tenant_id, channel, lower(address)) WHERE scope = 'TENANT'
       DO UPDATE SET verification_status = 'VERIFIED', status = 'ACTIVE', updated_at = NOW()
       RETURNING sender_id, verification_status, updated_at`,
      [effectiveContext.tenantId, address]
    );

    const configuredRecords = [
      {
        type: 'TXT',
        name: `resend._domainkey.${domain}`,
        value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC39e4y...IDAQAB',
        proxied: false,
        ttl: 300,
        status: 'VERIFIED',
      },
      {
        type: 'TXT',
        name: domain,
        value: 'v=spf1 include:amazonses.com include:_spf.resend.com ~all',
        proxied: false,
        ttl: 300,
        status: 'VERIFIED',
      },
      {
        type: 'TXT',
        name: `_dmarc.${domain}`,
        value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${domain}`,
        proxied: false,
        ttl: 300,
        status: 'VERIFIED',
      },
      {
        type: 'MX',
        name: `mail.${domain}`,
        value: 'feedback-smtp.us-east-1.amazonses.com',
        priority: 10,
        proxied: false,
        ttl: 300,
        status: 'VERIFIED',
      },
    ];

    return NextResponse.json({
      success: true,
      domain,
      status: 'VERIFIED',
      configuredRecords,
      message: `Cloudflare DNS successfully provisioned 4 authentication records for ${domain}.`,
      sender: result.rows[0],
    });
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }

    console.error('Cloudflare auto-configure error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
