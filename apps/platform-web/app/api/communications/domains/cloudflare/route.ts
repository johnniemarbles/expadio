import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, withTenantTransaction, deniedResponse } from "../../../../../lib/request-context";
import { expectedDnsRecords } from "../../../../../lib/dns-records";
import { findZone, upsertRecord, CloudflareError } from "../../../../../lib/cloudflare";
import { requireCommunicationDomainAdmin } from "../../../../../lib/communication-domain-admin";
import {
  CLOUDFLARE_DNS_CAPABILITY_KEY,
  resolveGovernedCloudflareDnsToken,
} from "../../../../../lib/governed-cloudflare-dns";

/**
 * Sending-domain DNS auto-configuration.
 *
 * The caller and existing sender state are checked before any governed
 * Cloudflare credential lease or provider call. DNS requirements are provisioned
 * only when provider-registry routing selects a Cloudflare DNS connector for
 * infrastructure.dns.configure; provider-issued DKIM remains untouched. The
 * resulting tenant sender stays PENDING and transactional-only until explicit
 * DNS + provider verification.
 *
 * This boundary never accepts a DNS credential from a browser request and never
 * reads route-level Cloudflare environment tokens. When no governed Cloudflare
 * connector is configured, the endpoint returns the DNS requirements for manual
 * configuration and performs no external mutation.
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
          error: "Cloudflare credentials cannot be supplied through this request. Configure governed DNS automation instead.",
          reasonKey: "BROWSER_DNS_CREDENTIAL_FORBIDDEN",
        },
        { status: 400 },
      );
    }

    const address = `notifications@${domain}`;
    const requestedAt = new Date().toISOString();
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
    const governedCredential = await withTenantTransaction(context, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return { allowed: false as const, credential: null };
      }
      return {
        allowed: true as const,
        credential: await resolveGovernedCloudflareDnsToken(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          subjectId: context.subjectId,
          domain,
          purpose: `communications.domain.configure:${domain}`,
          requestedAt,
        }),
      };
    });
    if (!governedCredential.allowed) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' }, { status: 403 });
    }

    let provisioned = false;
    let zoneName: string | null = null;
    let dnsConnectorKey: string | null = governedCredential.credential?.connectorKey ?? null;
    let results: { name: string; ok: boolean; action?: string; detail: string }[] | null = null;

    if (governedCredential.credential !== null) {
      try {
        const zone = await findZone(governedCredential.credential.token, domain);
        zoneName = zone.name;
        results = [];
        for (const record of records) {
          if (!record.verifiable) continue;
          const result = await upsertRecord(governedCredential.credential.token, zone.id, {
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
      ? `Configured ${results?.length ?? 0} verifiable DNS records in Cloudflare zone ${zoneName} using governed connector ${dnsConnectorKey}. Add/verify the provider-issued records too, then Verify.`
      : `Generated DNS requirements for ${domain}. No governed ${CLOUDFLARE_DNS_CAPABILITY_KEY} Cloudflare connector is configured, so add these records manually and then Verify.`;

    return NextResponse.json({
      success: true,
      domain,
      provisioned,
      manual: !provisioned,
      zone: zoneName,
      dnsConnectorKey,
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
