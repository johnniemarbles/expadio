import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { routeConnector } from '@expadio/provider-registry';
import { PostgresProviderRegistryRepository } from '@expadio/postgres-runtime/provider-registry';
import { CloudflareError, findZone, upsertRecord, readCnameRecord } from '../../../../../lib/cloudflare';
import {
  CLOUDFLARE_DNS_CAPABILITY_KEY,
  resolveGovernedCloudflareDnsToken,
} from '../../../../../lib/governed-cloudflare-dns';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CNAME_TARGET = 'forms.expadio.com';

// ── GET: check whether a governed Cloudflare connector is available ────────

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const connectorAvailable = await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
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

// ── POST: auto-configure CNAME via Cloudflare API and verify ──────────────

export async function POST() {
  try {
    const context = await resolveBrandContext();
    const requestedAt = new Date().toISOString();

    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
        return { forbidden: true } as const;
      }

      // Load configured brand domain.
      const row = await client.query<{ brand_domain: string | null }>(
        `SELECT brand_domain FROM platform.organizations WHERE organization_id = $1::uuid`,
        [context.organizationId],
      );
      const domain = row.rows[0]?.brand_domain ?? null;
      if (!domain) {
        return { noDomain: true } as const;
      }

      // Resolve the governed Cloudflare token.
      let governed;
      try {
        governed = await resolveGovernedCloudflareDnsToken(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          subjectId: context.subjectId,
          domain,
          purpose: 'Brand domain CNAME auto-configuration',
          requestedAt,
          requestId: randomUUID,
          correlationId: randomUUID,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { connectorError: msg } as const;
      }

      if (governed === null) {
        return { noConnector: true } as const;
      }

      return { domain, token: governed.token };
    });

    if ('forbidden' in result) {
      return NextResponse.json({ error: 'Brand governance authority is required.' }, { status: 403 });
    }
    if ('noDomain' in result) {
      return NextResponse.json({ error: 'No custom domain is configured. Save your domain first.' }, { status: 400 });
    }
    if ('noConnector' in result) {
      return NextResponse.json({ error: 'No Cloudflare DNS connector is configured for this tenant.' }, { status: 503 });
    }
    if ('connectorError' in result) {
      return NextResponse.json({ error: `Cloudflare connector error: ${result.connectorError}` }, { status: 503 });
    }

    const { domain, token } = result;

    // Outside the transaction: call Cloudflare API to upsert the CNAME and verify.
    let zone: { id: string; name: string };
    try {
      zone = await findZone(token, domain);
    } catch (err) {
      if (err instanceof CloudflareError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    // Upsert the CNAME record.
    let upsertResult;
    try {
      upsertResult = await upsertRecord(token, zone.id, {
        type: 'CNAME',
        name: domain,
        value: CNAME_TARGET,
      });
    } catch (err) {
      if (err instanceof CloudflareError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    // Read back the record to confirm it points correctly (works even when proxied).
    const content = await readCnameRecord(token, zone.id, domain);
    const verified = typeof content === 'string'
      && content.toLowerCase().replace(/\.$/, '') === CNAME_TARGET;

    if (verified) {
      // Mark verified in the database.
      await withBrandTransaction(context, async (client) => {
        await client.query(
          `UPDATE platform.organizations
              SET brand_domain_verified_at  = now(),
                  brand_domain_verify_token = $2
            WHERE organization_id = $1::uuid`,
          [context.organizationId, randomUUID()],
        );
      });
    }

    return NextResponse.json({
      verified,
      domain,
      action: upsertResult.action,
      cname: content ?? null,
      expected: CNAME_TARGET,
    });
  } catch (error) {
    console.error('Cloudflare brand domain auto-configure failed', error);
    return NextResponse.json({ error: 'Auto-configuration failed. Please try again.' }, { status: 500 });
  }
}
