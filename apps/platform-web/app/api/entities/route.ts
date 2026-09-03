import { NextResponse } from 'next/server';
import { NODE_TYPES, validateCreateEntityNode, type NodeType } from '@expadio/entity';
import { deniedResponse, requireStepUp, resolveRequestContext, withTenantTransaction } from '../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mapNode = (row: any) => ({
  nodeId: row.node_id, nodeType: row.node_type, displayName: row.display_name,
  externalRef: row.external_ref, organizationId: row.organization_id,
  status: row.status, dissolvedAt: row.dissolved_at, dissolvedBy: row.dissolved_by,
  metadata: row.metadata, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const nodeType = url.searchParams.get('nodeType');
    if (nodeType !== null && !NODE_TYPES.includes(nodeType as NodeType)) {
      return NextResponse.json({ error: 'INVALID_NODE_TYPE' }, { status: 400 });
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
    const result = await withTenantTransaction(context, (client) => client.query(
      `SELECT *, count(*) OVER()::int AS total_count FROM platform.entity_nodes
        WHERE tenant_id=$1::uuid AND ($2::text IS NULL OR node_type=$2)
        ORDER BY created_at DESC, node_id LIMIT $3 OFFSET $4`,
      [context.tenantId, nodeType, limit, offset],
    ));
    return NextResponse.json({
      items: result.rows.map(mapNode), total: result.rows[0]?.total_count ?? 0, limit, offset,
    });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();
    const body = await request.json() as Record<string, unknown>;
    const input = {
      tenantId: context.tenantId,
      nodeType: body.nodeType as NodeType,
      displayName: body.displayName as string,
      ...(typeof body.externalRef === 'string' ? { externalRef: body.externalRef } : {}),
      ...(typeof body.organizationId === 'string' ? { organizationId: body.organizationId } : {}),
      ...(body.metadata && typeof body.metadata === 'object' ? { metadata: body.metadata as Record<string, unknown> } : {}),
      createdBy: context.subjectId,
    };
    const errors = validateCreateEntityNode(input);
    if (errors.length) return NextResponse.json({ error: 'INVALID_ENTITY_NODE', details: errors }, { status: 400 });
    const result = await withTenantTransaction(context, (client) => client.query(
      `INSERT INTO platform.entity_nodes
        (tenant_id,node_type,display_name,external_ref,organization_id,metadata,created_by)
       VALUES ($1::uuid,$2,$3,$4,$5::uuid,$6::jsonb,$7) RETURNING *`,
      [context.tenantId, input.nodeType, input.displayName.trim(), input.externalRef ?? null,
       input.organizationId ?? null, JSON.stringify(input.metadata ?? {}), context.subjectId],
    ));
    return NextResponse.json({ item: mapNode(result.rows[0]) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'BRAND_HQ_ALREADY_EXISTS' }, { status: 409 });
    }
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
