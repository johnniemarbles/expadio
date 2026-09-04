import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildPublication, publicationSlugToUrlPath, resolveHostedFormUrl } from '@expadio/lead-capture';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

function generatePublishableKey(): string {
  const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(40);
  let body = '';
  for (const byte of bytes) body += BASE62[byte % 62];
  return `cpk_${body}`;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET: list publications for this organization ──────────────────────────────

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT p.publication_id, p.tenant_id, p.organization_id, p.capture_config_id,
                p.interest_type, p.opportunity_type,
                p.schema_key, p.qualification_profile_key, p.workflow_blueprint_key,
                p.evidence_profile_key, p.default_routing_profile_key,
                p.publication_mode, p.publication_slug, p.brand_domain,
                p.post_submit_redirect_url, p.enable_pre_fill,
                p.status, p.created_at, p.activated_at, p.archived_at,
                s.capture_source_id, s.label AS source_label,
                cs.publishable_key
           FROM platform.lead_publications p
           LEFT JOIN platform.lead_publication_sources s
             ON s.publication_id = p.publication_id
            AND s.tenant_id = p.tenant_id
            AND s.organization_id = p.organization_id
           LEFT JOIN platform.lead_capture_sources cs
             ON cs.source_id = s.capture_source_id
            AND cs.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1::uuid AND p.organization_id = $2::uuid
          ORDER BY p.created_at DESC`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json({
        publications: result.rows.map((row) => ({
          publicationId: row.publication_id,
          captureConfigId: row.capture_config_id,
          interestType: row.interest_type,
          opportunityType: row.opportunity_type,
          schemaKey: row.schema_key,
          qualificationProfileKey: row.qualification_profile_key,
          workflowBlueprintKey: row.workflow_blueprint_key,
          evidenceProfileKey: row.evidence_profile_key,
          defaultRoutingProfileKey: row.default_routing_profile_key,
          publicationMode: row.publication_mode,
          publicationSlug: row.publication_slug,
          brandDomain: row.brand_domain,
          hostedFormUrl: row.publication_mode === 'HOSTED_FORM' && row.brand_domain && row.publication_slug
            ? `https://${row.brand_domain}${publicationSlugToUrlPath(row.publication_slug)}`
            : null,
          postSubmitRedirectUrl: row.post_submit_redirect_url,
          enablePreFill: row.enable_pre_fill,
          status: row.status,
          captureSourceId: row.capture_source_id,
          captureSourceLabel: row.source_label,
          publishableKey: row.publishable_key ?? null,
          createdAt: new Date(row.created_at).toISOString(),
          activatedAt: row.activated_at ? new Date(row.activated_at).toISOString() : null,
          archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
        })),
      });
    });
  } catch (error) {
    console.error('Publication read failed:', error);
    return NextResponse.json({ error: 'Unable to load publications.' }, { status: 500 });
  }
}

// ── POST: create a new publication (atomically creates its source) ─────────────

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const body = await request.json();
    const captureConfigId = typeof body.captureConfigId === 'string' ? body.captureConfigId.trim() : '';
    const publicationMode = typeof body.publicationMode === 'string' ? body.publicationMode.trim().toUpperCase() : 'HOSTED_FORM';
    const captureSourceLabel = typeof body.captureSourceLabel === 'string' ? body.captureSourceLabel.trim() : '';

    if (!captureConfigId) {
      return NextResponse.json({ error: 'captureConfigId is required.' }, { status: 400 });
    }
    if (!captureSourceLabel) {
      return NextResponse.json({ error: 'captureSourceLabel is required (e.g. "Website /opportunity").' }, { status: 400 });
    }

    // Validate hosted-form config using the publication factory (Invariant 4 enforcement).
    let hostedFormConfig = null;
    if (publicationMode === 'HOSTED_FORM') {
      const publicationSlug = typeof body.publicationSlug === 'string' ? body.publicationSlug.trim() : '';
      const brandDomain = typeof body.brandDomain === 'string' ? body.brandDomain.trim() : '';
      if (!publicationSlug || !brandDomain) {
        return NextResponse.json({ error: 'publicationSlug and brandDomain are required for HOSTED_FORM publications.' }, { status: 400 });
      }
      hostedFormConfig = {
        publicationSlug,
        brandDomain,
        postSubmitRedirectUrl: typeof body.postSubmitRedirectUrl === 'string' && body.postSubmitRedirectUrl.trim()
          ? body.postSubmitRedirectUrl.trim()
          : null,
        enablePreFill: body.enablePreFill === true,
      };
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      // Load the Capture Configuration to copy behavioral keys.
      const configResult = await client.query(
        `SELECT config_id, interest_type, opportunity_type,
                schema_key, qualification_profile_key, workflow_blueprint_key,
                evidence_profile_key, default_routing_profile_key
           FROM platform.lead_management_configurations
          WHERE config_id = $1::uuid
            AND tenant_id = $2::uuid
            AND organization_id = $3::uuid
            AND status = 'PUBLISHED'
          LIMIT 1`,
        [captureConfigId, context.tenantId, context.organizationId],
      );
      if (configResult.rows.length === 0) {
        return NextResponse.json({
          error: 'Capture Configuration not found or not in PUBLISHED status. Only PUBLISHED configurations can produce Publications.',
        }, { status: 404 });
      }
      const config = configResult.rows[0];

      // Run the publication factory to validate all Invariant 4 rules before writing.
      const pubId = crypto.randomUUID();
      const srcId = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        const pub = buildPublication({
          publicationId: pubId,
          tenantId: context.tenantId,
          organizationId: context.organizationId!,
          captureConfigId,
          interestType: config.interest_type,
          opportunityType: config.opportunity_type,
          schemaKey: config.schema_key,
          qualificationProfileKey: config.qualification_profile_key,
          workflowBlueprintKey: config.workflow_blueprint_key,
          evidenceProfileKey: config.evidence_profile_key,
          defaultRoutingProfileKey: config.default_routing_profile_key,
          publicationMode: publicationMode as Parameters<typeof buildPublication>[0]['publicationMode'],
          hostedFormConfig,
          captureSourceId: srcId,
          captureSourceLabel,
          createdAt: now,
        });

        // Atomically insert publication + source.
        await client.query(
          `INSERT INTO platform.lead_publications
             (publication_id, tenant_id, organization_id, capture_config_id,
              interest_type, opportunity_type,
              schema_key, qualification_profile_key, workflow_blueprint_key,
              evidence_profile_key, default_routing_profile_key,
              publication_mode, publication_slug, brand_domain,
              post_submit_redirect_url, enable_pre_fill,
              status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                   $5, $6,
                   $7, $8, $9,
                   $10, $11,
                   $12, $13, $14,
                   $15, $16,
                   'DRAFT')`,
          [
            pub.publicationId, pub.tenantId, pub.organizationId, pub.captureConfigId,
            pub.interestType, pub.opportunityType,
            pub.schemaKey, pub.qualificationProfileKey, pub.workflowBlueprintKey,
            pub.evidenceProfileKey, pub.defaultRoutingProfileKey,
            pub.publicationMode,
            pub.hostedFormConfig?.publicationSlug ?? null,
            pub.hostedFormConfig?.brandDomain ?? null,
            pub.hostedFormConfig?.postSubmitRedirectUrl ?? null,
            pub.hostedFormConfig?.enablePreFill ?? null,
          ],
        );
        await client.query(
          `INSERT INTO platform.lead_publication_sources
             (capture_source_id, tenant_id, organization_id, publication_id, label)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`,
          [srcId, pub.tenantId, pub.organizationId, pub.publicationId, pub.captureSource.label],
        );

        // For HOSTED_FORM publications: also create a PUBLIC lead_capture_source
        // so the browser form can submit to platform-web without a signing secret.
        // Include both the custom brand domain and the platform slug domain (when
        // the org has a brand slug) so either URL passes the origin check.
        let publishableKey: string | null = null;
        if (pub.publicationMode === 'HOSTED_FORM') {
          const origins: string[] = [];
          if (pub.hostedFormConfig?.brandDomain) {
            origins.push(`https://${pub.hostedFormConfig.brandDomain}`);
          }
          if (context.brandSlug) {
            const slugOrigin = `https://${context.brandSlug}.expadio.com`;
            if (!origins.includes(slugOrigin)) origins.push(slugOrigin);
          }
          if (origins.length > 0) {
            publishableKey = generatePublishableKey();
            await client.query(
              `INSERT INTO platform.lead_capture_sources
                 (source_id, tenant_id, organization_id, source_key, surface, channel,
                  trust_rail, require_signed_ticket, publishable_key, allowed_origins, status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'WEB', 'WEB',
                       'PUBLIC', false, $5, $6::text[], 'ACTIVE')`,
              [srcId, pub.tenantId, pub.organizationId, `pub:${pub.publicationId}`, publishableKey, origins],
            );
          }
        }

        const hostedFormUrl = pub.hostedFormConfig
          ? resolveHostedFormUrl(pub)
          : null;

        return NextResponse.json({
          success: true,
          publicationId: pub.publicationId,
          captureSourceId: srcId,
          status: 'DRAFT',
          publicationMode: pub.publicationMode,
          hostedFormUrl,
          publishableKey,
          captureSourceLabel: pub.captureSource.label,
          createdAt: now,
        }, { status: 201 });
      } catch (error) {
        if (error instanceof Error && error.name === 'PublicationError') {
          return NextResponse.json({ error: error.message, code: (error as { code?: string }).code }, { status: 422 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Publication creation failed:', error);
    return NextResponse.json({ error: 'Unable to create publication.' }, { status: 500 });
  }
}
