import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../../lib/request-context";
import { expectedDnsRecords } from "../../../../../lib/dns-records";
import { findZone, upsertRecord, CloudflareError } from "../../../../../lib/cloudflare";

/**
 * Sending-domain auto-configuration (design: no fabricated VERIFIED).
 *
 * Authenticates with Cloudflare using a token supplied by the operator or the
 * deployment env, discovers the zone that owns the domain, and idempotently
 * creates/updates the required SPF, DMARC and return-path MX records. DKIM is
 * left to the sending provider. The sender identity is registered as PENDING;
 * it becomes VERIFIED only once the verify route resolves the records against
 * live DNS. Without a token it returns the records to add manually — it never
 * claims to have provisioned DNS it did not touch. The token is used
 * transiently and never persisted or logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json().catch(() => ({}));
    const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
    if (!DOMAIN_PATTERN.test(domain)) {
      return NextResponse.json({ error: "Enter a valid domain such as mail.example.com." }, { status: 400 });
    }

    const address = `notifications@${domain}`;
    const records = expectedDnsRecords(domain);
    const token = (typeof body.apiToken === "string" && body.apiToken.trim()) || process.env.CLOUDFLARE_API_TOKEN || "";

    let provisioned = false;
    let zoneName: string | null = null;
    let results: { name: string; ok: boolean; action?: string; detail: string }[] | null = null;

    if (token) {
      try {
        const zone = await findZone(token, domain);
        zoneName = zone.name;
        results = [];
        for (const record of records) {
          if (!record.verifiable) continue; // DKIM is provider-issued.
          const r = await upsertRecord(token, zone.id, { type: record.type, name: record.name, value: record.value, priority: record.priority });
          results.push(r);
        }
        provisioned = true;
      } catch (error) {
        if (error instanceof CloudflareError) {
          return NextResponse.json({ error: error.message, reasonKey: "CLOUDFLARE_ERROR" }, { status: error.status });
        }
        throw error;
      }
    }

    // Register (or refresh) the sender identity as PENDING regardless of path.
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

    const message = provisioned
      ? `Configured ${results?.length ?? 0} DNS records in Cloudflare zone ${zoneName}. Give DNS a moment to propagate, then Verify.`
      : `Generated ${records.length} DNS records for ${domain}. Paste a Cloudflare API token to auto-configure, or add them to your DNS and Verify.`;

    return NextResponse.json({
      success: true,
      domain,
      provisioned,
      manual: !provisioned,
      zone: zoneName,
      verificationStatus: "PENDING",
      records,
      cloudflare: results,
      message,
      sender,
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
