import { NextResponse } from 'next/server';
import { resolveRequestContext, deniedResponse, withTenantClient } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext();
    const body = await request.json().catch(() => ({}));
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
    if (!DOMAIN_PATTERN.test(domain)) return NextResponse.json({ error: 'Enter a valid domain such as mail.example.com.' }, { status: 400 });

    const token = process.env.CLOUDFLARE_API_TOKEN;
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (!token || !zoneId) return NextResponse.json({ error: 'Cloudflare auto-configuration is not enabled on this deployment. Configure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID before provisioning DNS.', code: 'CLOUDFLARE_NOT_CONFIGURED' }, { status: 503 });

    const zoneResponse = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const zonePayload = await zoneResponse.json().catch(() => null);
    if (!zoneResponse.ok || !zonePayload?.success) return NextResponse.json({ error: 'Cloudflare zone could not be verified for this deployment.', code: 'CLOUDFLARE_ZONE_CHECK_FAILED' }, { status: 502 });
    const zoneName = typeof zonePayload.result?.name === 'string' ? zonePayload.result.name.toLowerCase() : '';
    if (!zoneName || !(domain === zoneName || domain.endsWith(`.${zoneName}`))) return NextResponse.json({ error: `The domain is not inside the configured Cloudflare zone (${zoneName || 'unknown'}).`, code: 'DOMAIN_OUTSIDE_ZONE' }, { status: 400 });

    // Do not mark a sender VERIFIED or return fake DKIM/SPF/MX records. A real
    // provider-specific DKIM/sender adapter must supply the records and perform
    // the Cloudflare mutations before the identity can become VERIFIED.
    return await withTenantClient(context, async (client) => {
      const existing = await client.query(`SELECT sender_id,verification_status,status,updated_at FROM platform.communication_sender_identities WHERE tenant_id=$1::uuid AND channel='email' AND lower(address)=lower($2) LIMIT 1`, [context.tenantId, `notifications@${domain}`]);
      return NextResponse.json({ success: false, domain, status: existing.rows[0]?.verification_status || 'PENDING', configuredRecords: [], code: 'DNS_PROVISIONING_ADAPTER_REQUIRED', message: 'Cloudflare zone verified, but DNS records were not changed because the sender-identity/DKIM provisioning adapter is not configured.', sender: existing.rows[0] || null }, { status: 501 });
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Cloudflare auto-configure error:', err);
    return NextResponse.json({ error: err.message || 'Cloudflare configuration failed.' }, { status: 500 });
  }
}
