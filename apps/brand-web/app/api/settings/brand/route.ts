import { NextResponse } from 'next/server';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';
import { upsertCustomHostname, deleteCustomHostname, CloudflareSaasError } from '../../../../lib/cloudflare-saas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const result = await withBrandTransaction(context, async (client) => {
      const row = await client.query<{
        brand_slug: string | null;
        brand_display_name: string | null;
        brand_domain: string | null;
        brand_domain_verified_at: Date | null;
      }>(
        `SELECT brand_slug, brand_display_name, brand_domain, brand_domain_verified_at
           FROM platform.organizations
          WHERE organization_id = $1::uuid`,
        [context.organizationId],
      );
      return row.rows[0] ?? null;
    });

    if (!result) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });

    return NextResponse.json({
      brandSlug: result.brand_slug,
      brandDisplayName: result.brand_display_name,
      brandDomain: result.brand_domain,
      brandDomainVerifiedAt: result.brand_domain_verified_at?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('Brand settings GET failed', error);
    return NextResponse.json({ error: 'Could not load brand settings.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as null | Record<string, unknown>;
    if (!body) return NextResponse.json({ error: 'JSON body required.' }, { status: 400 });

    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
        return { forbidden: true } as const;
      }

      const current = await client.query<{
        brand_slug: string | null;
        brand_display_name: string | null;
        brand_domain: string | null;
        brand_domain_verified_at: Date | null;
        brand_domain_verify_token: string | null;
      }>(
        `SELECT brand_slug, brand_display_name, brand_domain, brand_domain_verified_at, brand_domain_verify_token
           FROM platform.organizations WHERE organization_id = $1::uuid`,
        [context.organizationId],
      );
      const cur = current.rows[0];

      const slug = 'brandSlug' in body
        ? (body.brandSlug === null ? null : String(body.brandSlug ?? '').trim().toLowerCase() || null)
        : cur?.brand_slug ?? null;

      const displayName = 'brandDisplayName' in body
        ? (body.brandDisplayName === null ? null : String(body.brandDisplayName ?? '').trim() || null)
        : cur?.brand_display_name ?? null;

      const rawDomain = 'brandDomain' in body
        ? (body.brandDomain === null ? null : String(body.brandDomain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '') || null)
        : cur?.brand_domain ?? null;

      if (slug !== null && !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
        return { invalid: true, error: 'Slug must be 3–50 lowercase letters, digits, or hyphens — no leading/trailing hyphen.' } as const;
      }

      const domainChanged = rawDomain !== (cur?.brand_domain ?? null);
      const verifiedAt = domainChanged ? null : cur?.brand_domain_verified_at ?? null;
      const verifyToken = domainChanged ? null : cur?.brand_domain_verify_token ?? null;

      await client.query(
        `UPDATE platform.organizations
            SET brand_slug                  = $2,
                brand_display_name          = $3,
                brand_domain                = $4,
                brand_domain_verified_at    = $5,
                brand_domain_verify_token   = $6,
                updated_at                  = now()
          WHERE organization_id = $1::uuid`,
        [context.organizationId, slug, displayName, rawDomain, verifiedAt, verifyToken],
      );

      return {
        ok: true,
        brandSlug: slug,
        brandDisplayName: displayName,
        brandDomain: rawDomain,
        brandDomainVerifiedAt: verifiedAt?.toISOString() ?? null,
        domainChanged,
        previousDomain: domainChanged ? (cur?.brand_domain ?? null) : null,
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ error: 'Brand governance authority is required.' }, { status: 403 });
    }
    if ('invalid' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Register/deregister the custom hostname in Cloudflare for SaaS so
    // Cloudflare provisions an SSL certificate and routes traffic through
    // the Worker proxy for this tenant domain.
    if ('domainChanged' in result && result.domainChanged) {
      try {
        if (result.previousDomain) {
          await deleteCustomHostname(result.previousDomain);
        }
        if (result.brandDomain) {
          await upsertCustomHostname(result.brandDomain);
        }
      } catch (saasErr) {
        if (saasErr instanceof CloudflareSaasError && saasErr.status === 503) {
          // CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN not configured — skip silently.
        } else {
          console.error('Cloudflare for SaaS hostname registration failed', saasErr);
        }
      }
    }

    const { domainChanged: _dc, previousDomain: _pd, ...response } = result as any;
    return NextResponse.json(response);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes('organizations_brand_slug_uniq')
    ) {
      return NextResponse.json({ error: 'That slug is already taken. Please choose a different one.' }, { status: 409 });
    }
    if (
      error instanceof Error &&
      error.message.includes('organizations_brand_domain_uniq')
    ) {
      return NextResponse.json({ error: 'That domain is already registered to another organisation.' }, { status: 409 });
    }
    console.error('Brand settings PATCH failed', error);
    return NextResponse.json({ error: 'Could not save brand settings.' }, { status: 500 });
  }
}
