import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';
import { calculateAndPersistDemandCaptureScore } from '../../../../../../lib/demand-capture-scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface ScoreRow {
  score_id: string;
  scoring_profile_id: string;
  profile_key: string;
  profile_version: number;
  total_score: string | number;
  band: string;
  calculation_reason: string;
  calculation_fingerprint: string | null;
  calculated_by_subject_id: string;
  calculated_at: Date | string;
}

function profileKey(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('profileKey must be a string.');
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || /[\0\r]/u.test(normalized)) throw new Error('Invalid profileKey.');
  return normalized;
}

function toScoreResponse(row: ScoreRow) {
  return {
    scoreId: row.score_id,
    scoringProfileId: row.scoring_profile_id,
    profileKey: row.profile_key,
    profileVersion: row.profile_version,
    totalScore: Number(row.total_score),
    band: row.band,
    calculationReason: row.calculation_reason,
    calculationFingerprint: row.calculation_fingerprint,
    calculatedBySubjectId: row.calculated_by_subject_id,
    calculatedAt: new Date(row.calculated_at).toISOString(),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });
    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' });
      if (module?.availability !== 'ACTIVE') return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      const lead = await client.query(`SELECT organization_id FROM platform.lead_capture_leads WHERE tenant_id=$1::uuid AND capture_lead_id=$2::uuid`, [context.tenantId, captureLeadId]);
      if (!lead.rows[0]) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      const scores = await client.query<ScoreRow>(
        `SELECT s.score_id, s.scoring_profile_id, p.profile_key, s.profile_version,
                s.total_score, s.band, s.calculation_reason, s.calculation_fingerprint,
                s.calculated_by_subject_id, s.calculated_at
           FROM platform.lead_scores s
           JOIN platform.lead_scoring_profiles p
             ON p.scoring_profile_id=s.scoring_profile_id
            AND p.tenant_id=s.tenant_id
            AND p.organization_id=s.organization_id
          WHERE s.tenant_id=$1::uuid AND s.capture_lead_id=$2::uuid
          ORDER BY s.calculated_at DESC, s.score_id DESC`,
        [context.tenantId, captureLeadId],
      );
      const history = scores.rows.map(toScoreResponse);
      return NextResponse.json({ captureLeadId, current: history[0] ?? null, history });
    });
  } catch (error) {
    console.error('Brand Demand Capture score read failed:', error);
    return NextResponse.json({ error: 'Unable to load Demand Capture score.' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    let selectedProfileKey: string | undefined;
    try { selectedProfileKey = profileKey(body.profileKey); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid profile key.' }, { status: 400 }); }

    const forbiddenAuthority = ['totalScore','band','components','calculationFingerprint','organizationId','tenantId','actorSubjectId']
      .find((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (forbiddenAuthority) {
      return NextResponse.json({
        denied: true,
        reasonKey: 'SCORING_AUTHORITY_FIELD_REJECTED',
        message: `${forbiddenAuthority} is derived by the governed scoring service and cannot be supplied by the request.`,
      }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' });
      if (module?.availability !== 'ACTIVE') return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      const leadResult = await client.query<{ organization_id: string }>(
        `SELECT organization_id FROM platform.lead_capture_leads WHERE tenant_id=$1::uuid AND capture_lead_id=$2::uuid`,
        [context.tenantId, captureLeadId],
      );
      const lead = leadResult.rows[0];
      if (!lead) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, lead.organization_id)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      const score = await calculateAndPersistDemandCaptureScore(client, {
        tenantId: context.tenantId,
        captureLeadId,
        actorSubjectId: context.subjectId,
        ...(selectedProfileKey === undefined ? {} : { profileKey: selectedProfileKey }),
      });
      if (!score) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      return NextResponse.json({ success: true, ...score });
    });
  } catch (error) {
    console.error('Brand Demand Capture score calculation failed:', error);
    const message = error instanceof Error ? error.message : 'Unable to calculate Demand Capture score.';
    if (message === 'LEAD_SCORING_ACTIVE_PROFILE_NOT_FOUND') {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to calculate Demand Capture score.' }, { status: 500 });
  }
}
