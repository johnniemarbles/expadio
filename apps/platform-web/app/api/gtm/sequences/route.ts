import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';

/** Tenant-scoped GTM sequences. POST files a draft bound to gtm.sequence.publish. Does not send. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT sequence_id, brand_id, icp_id, name, status, author_subject_id,
                blueprint_key, workflow_instance_id, stage_key, created_at
           FROM platform.gtm_sequences
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
      return NextResponse.json({ error: 'A sequence name (1–200 characters) is required.' }, { status: 400 });
    }
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 });
    }
    const icpId = typeof body?.icpId === 'string' && body.icpId.trim() !== '' ? body.icpId : null;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const inserted = await client.query(
        `INSERT INTO platform.gtm_sequences
           (tenant_id, brand_id, icp_id, name, status, author_subject_id, payload, blueprint_key)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'draft', $5, $6::jsonb, 'gtm.sequence.publish')
         RETURNING sequence_id`,
        [context.tenantId, brandId, icpId, name, context.subjectId, JSON.stringify(body?.payload ?? {})],
      );
      return { sequenceId: inserted.rows[0].sequence_id as string } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to file a sequence.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, sequenceId: result.sequenceId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
