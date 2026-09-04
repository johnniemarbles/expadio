import dns from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CNAME_TARGET = 'forms.expadio.com';

export async function POST() {
  try {
    const context = await resolveBrandContext();

    const domain = await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
        return { forbidden: true } as const;
      }
      const row = await client.query<{ brand_domain: string | null }>(
        `SELECT brand_domain FROM platform.organizations WHERE organization_id = $1::uuid`,
        [context.organizationId],
      );
      return row.rows[0]?.brand_domain ?? null;
    });

    if (domain && typeof domain === 'object' && 'forbidden' in domain) {
      return NextResponse.json({ error: 'Brand governance authority is required.' }, { status: 403 });
    }
    if (!domain || typeof domain !== 'string') {
      return NextResponse.json({ error: 'No custom domain is configured for this organisation.' }, { status: 400 });
    }

    let cnames: string[] = [];
    try {
      cnames = await dns.resolveCname(domain);
    } catch {
      return NextResponse.json({
        verified: false,
        domain,
        expected: CNAME_TARGET,
        found: [],
        message: `No CNAME record found for ${domain}. Add a CNAME pointing to ${CNAME_TARGET} and try again.`,
      });
    }

    const matched = cnames.some(
      (c) => c.toLowerCase().replace(/\.$/, '') === CNAME_TARGET,
    );

    if (!matched) {
      return NextResponse.json({
        verified: false,
        domain,
        expected: CNAME_TARGET,
        found: cnames,
        message: `CNAME found but points to ${cnames[0] ?? '(unknown)'} instead of ${CNAME_TARGET}.`,
      });
    }

    await withBrandTransaction(context, async (client) => {
      await client.query(
        `UPDATE platform.organizations
            SET brand_domain_verified_at  = now(),
                brand_domain_verify_token = $2
          WHERE organization_id = $1::uuid`,
        [context.organizationId, randomUUID()],
      );
    });

    return NextResponse.json({ verified: true, domain, expected: CNAME_TARGET });
  } catch (error) {
    console.error('Brand domain verify failed', error);
    return NextResponse.json({ error: 'Verification check failed. Please try again.' }, { status: 500 });
  }
}
