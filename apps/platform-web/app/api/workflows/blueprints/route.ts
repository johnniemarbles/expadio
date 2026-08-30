import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const rows = await withTenantClient(effectiveContext, async (client) => {
      const result = await client.query(
        `SELECT blueprint_key, label as display_name, version, state as status, created_at
         FROM platform.workflow_blueprints
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [effectiveContext.tenantId]
      );
      return result.rows;
    });
    
    return NextResponse.json(rows);
  } catch (err: any) {
    const denied = deniedResponse(err);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const { blueprint_key, label, version = 1, stages = [] } = await request.json();
    if (!blueprint_key || !label) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    const rows = await withTenantClient(effectiveContext, async (client) => {
      const result = await client.query(
        `INSERT INTO platform.workflow_blueprints (tenant_id, blueprint_key, version, label, work_type_key, source, state, stages, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'DEFAULT_WORK', 'TENANT_CUSTOMIZED', 'DRAFT', $5, NOW(), NOW())
         RETURNING blueprint_key`,
        [effectiveContext.tenantId, blueprint_key, version, label, JSON.stringify(stages)]
      );
      return result.rows;
    });

    return NextResponse.json({ success: true, blueprint_key: rows[0].blueprint_key });
  } catch (err: any) {
    const denied = deniedResponse(err);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function PUT(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const { blueprint_key, state } = await request.json();
    if (!blueprint_key || !state) return NextResponse.json({ error: 'Missing key or state' }, { status: 400 });

    const updateResult = await withTenantClient(effectiveContext, async (client) => {
      const result = await client.query(
        `UPDATE platform.workflow_blueprints SET state = $1, updated_at = NOW()
         WHERE blueprint_key = $2 AND tenant_id = $3
         RETURNING blueprint_key, state`,
        [state, blueprint_key, effectiveContext.tenantId]
      );
      return { rowCount: result.rowCount, rows: result.rows };
    });

    if (updateResult.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, blueprint: updateResult.rows[0] });
  } catch (err: any) {
    const denied = deniedResponse(err);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
