import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { dbPool } from '../../../../lib/brand-context';
import EnquiryFormClient from './EnquiryFormClient';

export const dynamic = 'force-dynamic';

const EXPADIO_APEX = process.env.EXPADIO_APEX_DOMAIN || 'expadio.com';

interface OrgRow {
  tenant_id: string;
  organization_id: string;
  org_name: string;
  brand_display_name: string | null;
  brand_slug: string | null;
  brand_domain: string | null;
}

interface PublicationRow {
  publication_id: string;
  capture_config_id: string;
  interest_type: string;
  opportunity_type: string | null;
  publication_slug: string | null;
  brand_domain: string | null;
  capture_source_id: string;
  publishable_key: string;
}

async function resolveOrg(hostname: string): Promise<OrgRow | null> {
  const client = await dbPool.connect();
  try {
    // Strip port for local dev
    const host = hostname.split(':')[0];
    // Check if it's a subdomain of the expadio apex
    const slugMatch = host.endsWith(`.${EXPADIO_APEX}`) && host !== EXPADIO_APEX;
    let result;
    if (slugMatch) {
      const slug = host.slice(0, host.length - EXPADIO_APEX.length - 1);
      result = await client.query<OrgRow>(
        `SELECT * FROM platform.lookup_org_by_brand_slug($1)`,
        [slug],
      );
    } else {
      result = await client.query<OrgRow>(
        `SELECT * FROM platform.lookup_org_by_brand_domain($1)`,
        [host],
      );
    }
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

async function resolvePublications(tenantId: string, organizationId: string): Promise<PublicationRow[]> {
  const client = await dbPool.connect();
  try {
    const result = await client.query<PublicationRow>(
      `SELECT * FROM platform.lookup_public_hosted_forms($1::uuid, $2::uuid)`,
      [tenantId, organizationId],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export default async function EnquiryPage(
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const reqHeaders = await headers();
  // X-Forwarded-Host is set by the Cloudflare Worker (subdomain traffic) and by the
  // Cloudflare Transform Rule (custom domain traffic). Use it when present so that
  // the original customer-facing hostname is used for tenant resolution even when
  // the Host header has been overridden to the Railway origin hostname.
  const hostname = reqHeaders.get('x-forwarded-host') ?? reqHeaders.get('host') ?? '';
  const { slug: slugParts } = await params;
  // slugParts is undefined for /enquire, ['su'] for /enquire/su, etc.
  const offeringSlug = slugParts?.[0] ?? null;

  // Diagnostic: log all headers to find which one carries the original custom domain
  const diagHeaders: Record<string, string> = {};
  for (const key of ['host', 'x-forwarded-host', 'x-forwarded-for', 'x-real-ip',
    'cf-ray', 'cf-connecting-ip', 'cf-visitor', 'cf-ipcountry',
    'x-original-host', 'x-custom-host', 'forwarded', 'via', 'origin',
    'referer', 'x-railway-request-id',
  ]) {
    const v = reqHeaders.get(key);
    if (v) diagHeaders[key] = v;
  }
  console.error('[enquire] headers:', JSON.stringify(diagHeaders));

  const org = await resolveOrg(hostname);
  if (!org) {
    console.error('[enquire] org not found for hostname:', hostname);
    return notFound();
  }

  const publications = await resolvePublications(org.tenant_id, org.organization_id);
  if (publications.length === 0) {
    console.error('[enquire] no publications for org:', org.organization_id, 'slugs available: none');
    return notFound();
  }

  // Find the matching publication: if no slug pick the only one, otherwise match
  let pub: PublicationRow | undefined;
  if (!offeringSlug) {
    pub = publications[0];
  } else {
    pub = publications.find((p) => {
      const s = p.publication_slug ?? '';
      // publication_slug is /enquire or /enquire-su; the URL path gives just 'su'
      return s === `/enquire-${offeringSlug}` || s === '/enquire';
    });
  }
  if (!pub) {
    console.error('[enquire] no matching slug for offeringSlug:', offeringSlug, 'available slugs:', publications.map((p) => p.publication_slug));
    return notFound();
  }

  const platformWebUrl = process.env.PLATFORM_WEB_BASE_URL ?? '';

  return (
    <EnquiryFormClient
      tenantId={org.tenant_id}
      organizationId={org.organization_id}
      brandDisplayName={org.brand_display_name}
      organizationName={org.org_name}
      sourceId={pub.capture_source_id}
      publishableKey={pub.publishable_key}
      interestType={pub.interest_type}
      opportunityType={pub.opportunity_type}
      platformWebUrl={platformWebUrl}
      publications={publications.map((p) => ({
        publicationId: p.publication_id,
        interestType: p.interest_type,
        opportunityType: p.opportunity_type,
        publicationSlug: p.publication_slug,
        captureSourceId: p.capture_source_id,
        publishableKey: p.publishable_key,
      }))}
      selectedPublicationId={pub.publication_id}
    />
  );
}
