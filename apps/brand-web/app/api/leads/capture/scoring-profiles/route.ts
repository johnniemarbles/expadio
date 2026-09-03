import { NextResponse } from 'next/server';
import { validateLeadScoringProfileDefinition } from '../../../../../lib/lead-scoring-domain';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\0\r]/u.test(text)) return null;
  return text;
}

async function requireScoringGovernance(
  client: Parameters<Parameters<typeof withBrandTransaction>[1]>[0],
  context: Awaited<ReturnType<typeof resolveBrandContext>>,
) {
  const module = await loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  });
  if (module?.availability !== 'ACTIVE') {
    return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
  }
  if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
    return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const denied = await requireScoringGovernance(client, context);
      if (denied) return denied;
      const result = await client.query<{
        scoring_profile_id: string;
        profile_key: string;
        name: string;
        version: number;
        components: unknown;
        band_thresholds: unknown;
        status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
        created_at: Date | string;
        activated_at: Date | string | null;
        retired_at: Date | string | null;
      }>(
        `SELECT scoring_profile_id, profile_key, name, version, components,
                band_thresholds, status, created_at, activated_at, retired_at
           FROM platform.lead_scoring_profiles
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          ORDER BY profile_key ASC, version DESC`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json({
        organizationId: context.organizationId,
        profiles: result.rows.map((row) => ({
          scoringProfileId: row.scoring_profile_id,
          profileKey: row.profile_key,
          name: row.name,
          version: row.version,
          components: row.components,
          bandThresholds: row.band_thresholds,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
          activatedAt: row.activated_at === null ? null : new Date(row.activated_at).toISOString(),
          retiredAt: row.retired_at === null ? null : new Date(row.retired_at).toISOString(),
        })),
      });
    });
  } catch (error) {
    console.error('Brand Demand Capture scoring profile read failed:', error);
    return NextResponse.json({ error: 'Unable to load scoring profiles.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const profileKey = boundedString(body.profileKey, 120);
    const name = boundedString(body.name, 180);
    const version = Number(body.version);
    if (!profileKey || !name || !Number.isInteger(version) || version <= 0) {
      return NextResponse.json({ error: 'profileKey, name and a positive integer version are required.' }, { status: 400 });
    }

    let definition;
    try {
      definition = validateLeadScoringProfileDefinition({
        components: Array.isArray(body.components) ? body.components : [],
        bandThresholds: body.bandThresholds && typeof body.bandThresholds === 'object' && !Array.isArray(body.bandThresholds)
          ? body.bandThresholds
          : {},
      } as Parameters<typeof validateLeadScoringProfileDefinition>[0]);
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Invalid scoring profile definition.',
      }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const denied = await requireScoringGovernance(client, context);
      if (denied) return denied;
      try {
        const inserted = await client.query<{ scoring_profile_id: string }>(
          `INSERT INTO platform.lead_scoring_profiles (
             tenant_id, organization_id, profile_key, name, version,
             components, band_thresholds, status, created_by_subject_id
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::jsonb,'DRAFT',$8)
           RETURNING scoring_profile_id`,
          [
            context.tenantId,
            context.organizationId,
            profileKey,
            name,
            version,
            JSON.stringify(definition.components),
            JSON.stringify(definition.bandThresholds),
            context.subjectId,
          ],
        );
        return NextResponse.json({
          success: true,
          scoringProfileId: inserted.rows[0]?.scoring_profile_id,
          status: 'DRAFT',
        }, { status: 201 });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return NextResponse.json({
            denied: true,
            reasonKey: 'SCORING_PROFILE_VERSION_CONFLICT',
            message: 'That scoring profile version already exists in this organization.',
          }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Brand Demand Capture scoring profile create failed:', error);
    return NextResponse.json({ error: 'Unable to create scoring profile.' }, { status: 500 });
  }
}
