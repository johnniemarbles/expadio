import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../../lib/request-context";
import { expectedDnsRecords } from "../../../../../lib/dns-records";
import { findZone, upsertRecord, CloudflareError } from "../../../../../lib/cloudflare";
import { requireCommunicationDomainAdmin } from "../../../../../lib/communication-domain-admin";

/**
 * Sending-domain auto-configuration (design: no fabricated VERIFIED).
 *
 * The caller is authorized before any Cloudflare request or token use. DNS
 * requirements are provisioned only when a transient/deployment token is
 * available; provider-issued DKIM remains untouched. The resulting tenant
 * sender stays PENDING and transactional-only until explicit DNS verification.
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

    const authorized = await withTenantClient(context, (client) =>
      requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId),
    );
    if (!authorized) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' }, { status: 403 });
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
          if (!record.verifiable) continue;
          const result = await upsertRecord(token, zone.id, {
            type: record.type,
            name: record.name,
            value: record.value,
            priority: record.priority,
          });
          results.push(result);
        }
        provisioned = true;
      } catch (error) {
        if (error instanceof CloudflareError) {
          return NextResponse.json({ error: error.message, reasonKey: "CLOUDFLARE_ERROR" }, { status: error.status });
        }
        throw error;
      }
    }

    const sender = await withTenantClient(context, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return null;
      }
      const result = await client.query(
        `INSERT INTO platform.communication_sender_identities
           (tenant_id, organization_id, scope, channel, address, display_name, purposes, is_default, verification_status, status)
         VALUES ($1, NULL, 'TENANT', 'email', $2, 'Tenant Sender', ARRAY['transactional'], false, 'PENDING', 'ACTIVE')
         ON CONFLICT (tenant_id, channel, lower(address)) WHERE scope = 'TENANT'
         DO UPDATE SET
           status = 'ACTIVE',
           purposes = ARRAY['transactional'],
           is_default = false,
           verification_status = platform.communication_sender_identities.verification_status,
           updated_at = now()
         RETURNING sender_id, address, purposes, is_default, verification_status, updated_at`,
        [context.tenantId, address],
      );
      return result.rows[0];
    });
    if (!sender) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' }, { status: 403 });
    }

    const message = provisioned
      ? `Configured ${results?.length ?? 0} verifiable DNS records in Cloudflare zone ${zoneName}. Give DNS a moment to propagate, then Verify.`
      : `Generated DNS requirements for ${domain}. Paste a Cloudflare API token to auto-configure verifiable records, or add them to your DNS and Verify.`;

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
