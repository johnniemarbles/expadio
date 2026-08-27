import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../../lib/request-context";
import { expectedDnsRecords } from "../../../../../lib/dns-records";

/**
 * Sending-domain preflight (design: no fabricated VERIFIED).
 *
 * Registers the sender identity as PENDING and produces the exact DNS records
 * the domain needs. If a Cloudflare API token and zone are configured
 * (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID), it creates the records in that
 * zone and reports per-record results. Without them it returns the records for
 * the operator to add manually — it never claims to have provisioned DNS it
 * did not touch. Either way the domain becomes VERIFIED only after the
 * verify route resolves the records against live DNS.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CF_API = "https://api.cloudflare.com/client/v4";

async function createInCloudflare(
  token: string,
  zoneId: string,
  records: ReturnType<typeof expectedDnsRecords>,
): Promise<{ provisioned: number; results: { name: string; ok: boolean; detail: string }[] }> {
  const results: { name: string; ok: boolean; detail: string }[] = [];
  let provisioned = 0;
  for (const record of records) {
    if (!record.verifiable) continue; // DKIM key is provider-issued; skip.
    try {
      const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: record.type,
          name: record.name,
          content: record.value,
          ...(record.priority !== undefined ? { priority: record.priority } : {}),
          ttl: 300,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body?.success !== false;
      if (ok) provisioned += 1;
      results.push({
        name: record.name,
        ok,
        detail: ok ? "created" : (body?.errors?.[0]?.message ?? `Cloudflare HTTP ${res.status}`),
      });
    } catch (error) {
      results.push({ name: record.name, ok: false, detail: (error as Error).message });
    }
  }
  return { provisioned, results };
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json().catch(() => ({}));
    const domain: string = (typeof body.domain === "string" && body.domain.trim()) || "expadio.com";
    const address = `notifications@${domain}`;
    const records = expectedDnsRecords(domain);

    const token = process.env.CLOUDFLARE_API_TOKEN;
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const canProvision = Boolean(token && zoneId);

    let provisionSummary: { provisioned: number; results: { name: string; ok: boolean; detail: string }[] } | null = null;
    if (canProvision) {
      provisionSummary = await createInCloudflare(token!, zoneId!, records);
    }

    const sender = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `INSERT INTO platform.communication_sender_identities
           (tenant_id, organization_id, scope, channel, address, display_name, purposes, is_default, verification_status, status)
         VALUES ($1, NULL, 'TENANT', 'email', $2, 'Platform Sender', ARRAY['transactional','marketing','system'], true, 'PENDING', 'ACTIVE')
         ON CONFLICT (tenant_id, channel, lower(address)) WHERE scope = 'TENANT'
         DO UPDATE SET status = 'ACTIVE', updated_at = now()
         RETURNING sender_id, verification_status, updated_at`,
        [context.tenantId, address],
      );
      return result.rows[0];
    });

    const message = canProvision
      ? `Created ${provisionSummary?.provisioned ?? 0} DNS records in Cloudflare for ${domain}. Verify to confirm propagation.`
      : `Generated ${records.length} DNS records for ${domain}. Add them to your DNS provider, then Verify. (Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to auto-provision.)`;

    return NextResponse.json({
      success: true,
      domain,
      provisioned: canProvision,
      manual: !canProvision,
      verificationStatus: "PENDING",
      records,
      cloudflare: provisionSummary,
      message,
      sender,
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
