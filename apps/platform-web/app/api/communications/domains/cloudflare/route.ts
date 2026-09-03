import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../../lib/request-context";
import { expectedDnsRecords } from "../../../../../lib/dns-records";
import { findZone, upsertRecord, CloudflareError } from "../../../../../lib/cloudflare";
import { requireCommunicationDomainAdmin } from "../../../../../lib/communication-domain-admin";

/**
 * Sending-domain DNS auto-configuration.
 *
 * The caller and existing sender state are checked before any Cloudflare token
 * or provider call. DNS requirements are provisioned only when a transient or
 * deployment token is available; provider-issued DKIM remains untouched. The
 * resulting tenant sender stays PENDING and transactional-only until explicit
 * DNS + provider verification.
 * 
 * Cloudflare credentials are deployment-held infrastructure credentials. This
 * boundary never accepts a DNS credential from a browser request. When the
 * deployment has no Cloudflare token configured, the endpoint returns the DNS
 * requirements for manual configuration and performs no external mutation.
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
    if (typeof body.apiToken === "string" && body.apiToken.trim()) {
      return NextResponse.json(
        {
          error: "Cloudflare credentials cannot be supplied through this request. Configure deployment DNS automation instead.",
          reasonKey: "BROWSER_DNS_CREDENTIAL_FORBIDDEN",
        },
        { status: 400 },
      );
    }

    const address = `notifications@${domain}`;
    const authorized = await withTenantClient(context, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return { allowed: false as const, suspended: false };
      }
      const existing = await client.query<{ status: string }>(
        `SELECT status
           FROM platform.communication_sender_identities
          WHERE tenant_id = $1::uuid
            AND scope = 'TENANT'
            AND channel = 'email'
            AND lower(address) = lower($2)
          LIMIT 1`,
        [context.tenantId, address],
      );
      return {
        allowed: true as const,
        suspended: existing.rows[0]?.status === 'SUSPENDED',
      };
    });
    if (!authorized.allowed) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' }, { status: 403 });
    }
    if (authorized.suspended) {
      return NextResponse.json(
        { error: 'This sender is suspended and can only be restored through Platform governance.' },
        { status: 409 },
      );
    }

    const records = expectedDnsRecords(domain);
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";

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
           status = CASE
             WHEN platform.communication_sender_identities.status = 'INACTIVE' THEN 'ACTIVE'
             ELSE platform.communication_sender_identities.status
           END,
           purposes = ARRAY['transactional'],
           is_default = false,
           verification_status = platform.communication_sender_identities.verification_status,
           updated_at = now()
         RETURNING sender_id, address, purposes, is_default, verification_status, status, updated_at`,
        [context.tenantId, address],
      );
      return result.rows[0];
    });
    if (sender === null) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' }, { status: 403 });
    }

    const message = provisioned
      ? `Configured ${results?.length ?? 0} verifiable DNS records in Cloudflare zone ${zoneName}. Add/verify the provider-issued records too, then Verify.`
      : `Generated DNS requirements for ${domain}. Deployment Cloudflare automation is not configured, so add these records manually and then Verify.`;

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
