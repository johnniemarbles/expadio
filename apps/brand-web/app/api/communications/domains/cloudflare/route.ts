import { NextResponse } from 'next/server';
import { routeConnector } from '@expadio/provider-registry';
import { PostgresProviderRegistryRepository } from '@expadio/postgres-runtime/provider-registry';
import { CloudflareError, findZone, upsertRecord } from '../../../../../lib/cloudflare';
import {
  CLOUDFLARE_DNS_CAPABILITY_KEY,
  resolveGovernedCloudflareDnsToken,
} from '../../../../../lib/governed-cloudflare-dns';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';
import { expectedDnsRecords } from '../../../../../lib/dns-records';

/**
 * Email sending-domain DNS auto-configuration for brand organizations.
 *
 * GET  — reports whether a governed Cloudflare DNS connector is available.
 * POST — upserts SPF, DMARC, and return-path MX records for the given domain
 *        using the tenant's governed Cloudflare credential. DKIM is issued by
 *        the email provider (Resend) and must be added separately. No DNS
 *        credentials are accepted from the browser request.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const connectorAvailable = await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return false;
      }
      const registry = new PostgresProviderRegistryRepository(client);
      const connectors = await registry.listConnectors(context.tenantId, CLOUDFLARE_DNS_CAPABILITY_KEY);
      const policy = await registry.loadRoutingPolicy(context.tenantId, CLOUDFLARE_DNS_CAPABILITY_KEY);
      const route = routeConnector(
        { tenantId: context.tenantId, capabilityKey: CLOUDFLARE_DNS_CAPABILITY_KEY },
        connectors,
        policy ?? undefined,
      );
      return route.connector !== null && route.connector.enabled;
    });
    return NextResponse.json({ connectorAvailable });
  } catch {
    return NextResponse.json({ connectorAvailable: false });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => ({}));
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';

    if (!DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: 'Enter a valid sending domain such as mail.example.com.' }, { status: 400 });
    }
    if (typeof body.apiToken === 'string' && body.apiToken.trim()) {
      return NextResponse.json(
        {
          error: 'Cloudflare credentials cannot be supplied through this request. Configure governed DNS automation instead.',
          reasonKey: 'BROWSER_DNS_CREDENTIAL_FORBIDDEN',
        },
        { status: 400 },
      );
    }

    const requestedAt = new Date().toISOString();
    const records = expectedDnsRecords(domain);

    const governedCredential = await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
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
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' },
        { status: 403 },
      );
    }

    let provisioned = false;
    let zoneName: string | null = null;
    const dnsConnectorKey: string | null = governedCredential.credential?.connectorKey ?? null;
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
          return NextResponse.json({ error: error.message, reasonKey: 'CLOUDFLARE_ERROR' }, { status: error.status });
        }
        throw error;
      }
    }

    const message = provisioned
      ? `Configured ${results?.length ?? 0} DNS records in Cloudflare zone ${zoneName}. Add the DKIM record from Resend, then click Verify.`
      : `No governed Cloudflare DNS connector is configured for this tenant. Add the DNS records manually, then click Verify.`;

    return NextResponse.json({
      success: true,
      domain,
      provisioned,
      manual: !provisioned,
      zone: zoneName,
      dnsConnectorKey,
      records,
      cloudflare: results,
      message,
    });
  } catch (error) {
    console.error('Brand Cloudflare email DNS auto-configure failed:', error);
    return NextResponse.json({ error: 'DNS auto-configuration failed. Please try again.' }, { status: 500 });
  }
}
