import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';

/** Tenant-scoped GTM campaigns. POST files a draft bound to gtm.campaign.launch. Does not send. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT campaign_id, brand_id, icp_id, sequence_id, name, status, daily_send_cap,
                blueprint_key, workflow_instance_id, stage_key, created_at
           FROM platform.gtm_campaigns
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
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name === '' || name.length > 200) {
      return NextResponse.json({ error: 'A campaign name (1–200 characters) is required.' }, { status: 400 });
    }
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const inserted = await client.query(
        `INSERT INTO platform.gtm_campaigns (tenant_id, brand_id, name, status, blueprint_key)
         VALUES ($1::uuid, $2::uuid, $3, 'draft', 'gtm.campaign.launch')
         RETURNING campaign_id`,
        [context.tenantId, brandId, name],
      );
      return { campaignId: inserted.rows[0].campaign_id as string } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to file a campaign.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, campaignId: result.campaignId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
