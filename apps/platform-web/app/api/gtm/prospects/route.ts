import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';
import {
  fitInputFromObservation,
  icpFitTargetFromPayload,
  scoreProspectObservation,
} from '../../../../lib/gtm-engines';

/**
 * Tenant-scoped prospect observations.
 * Scores against an ICP payload. Does not enqueue send.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT observation_id, brand_id, campaign_id, status, fit_score, payload, created_at
           FROM platform.gtm_prospect_observations
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return result.rows;
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 });
    }
    if (!email.includes('@')) {
      return NextResponse.json({ error: 'email is required.' }, { status: 400 });
    }
    const campaignId =
      typeof body?.campaignId === 'string' && body.campaignId.trim() !== '' ? body.campaignId : null;
    const icpId = typeof body?.icpId === 'string' && body.icpId.trim() !== '' ? body.icpId : null;
    const industry = typeof body?.industry === 'string' ? body.industry.trim() : undefined;
    const geography = typeof body?.geography === 'string' ? body.geography.trim() : undefined;
    const companySize = typeof body?.companySize === 'string' ? body.companySize.trim() : undefined;
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
    const seniority = typeof body?.seniority === 'string' ? body.seniority.trim() : undefined;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      let icpPayload: unknown = {};
      if (icpId) {
        const icp = await client.query(
          `SELECT payload FROM platform.gtm_icps WHERE icp_id = $1::uuid`,
          [icpId],
        );
        icpPayload = icp.rows[0]?.payload ?? {};
      }
      const score = scoreProspectObservation(
        fitInputFromObservation({ email, industry, geography, companySize, title, seniority }),
        icpFitTargetFromPayload(icpPayload),
      );
      const payload = {
        email,
        icpId,
        industry,
        geography,
        companySize,
        title,
        seniority,
        score,
      };
      const inserted = await client.query(
        `INSERT INTO platform.gtm_prospect_observations
           (tenant_id, brand_id, campaign_id, status, fit_score, payload)
         VALUES ($1::uuid, $2::uuid, $3, 'observed', $4, $5::jsonb)
         RETURNING observation_id`,
        [context.tenantId, brandId, campaignId, score.total, JSON.stringify(payload)],
      );
      return {
        observationId: inserted.rows[0].observation_id as string,
        fitScore: score.total,
        band: score.band,
        version: score.version,
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to observe a prospect.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
