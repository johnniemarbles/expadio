import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';

/** Tenant-scoped ICP proposals. POST files a proposal bound to gtm.icp.publish. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT icp_id, brand_id, name, status, review_status, version,
                blueprint_key, workflow_instance_id, stage_key, created_at
           FROM platform.gtm_icps
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
      return NextResponse.json({ error: 'An ICP name (1–200 characters) is required.' }, { status: 400 });
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
        `INSERT INTO platform.gtm_icps (tenant_id, brand_id, name, status, review_status, payload, blueprint_key)
         VALUES ($1::uuid, $2::uuid, $3, 'proposal', 'unreviewed', $4::jsonb, 'gtm.icp.publish')
         RETURNING icp_id`,
        [context.tenantId, brandId, name, JSON.stringify(body?.payload ?? {})],
      );
      return { icpId: inserted.rows[0].icp_id as string } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to propose an ICP.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, icpId: result.icpId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
