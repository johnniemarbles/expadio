import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const { nodeId } = await params;
    const result = await withTenantTransaction(context, (client) => client.query(
      `SELECT n.*, to_jsonb(le)-'tenant_id'-'node_id' AS legal_entity,
               to_jsonb(lu)-'tenant_id'-'node_id' AS location_unit
         FROM platform.entity_nodes n
         LEFT JOIN platform.legal_entities le ON le.tenant_id=n.tenant_id AND le.node_id=n.node_id
         LEFT JOIN platform.location_units lu ON lu.tenant_id=n.tenant_id AND lu.node_id=n.node_id
        WHERE n.tenant_id=$1::uuid AND n.node_id=$2::uuid LIMIT 1`,
      [context.tenantId, nodeId],
    ));
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: 'NODE_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ item: {
      nodeId: row.node_id, nodeType: row.node_type, displayName: row.display_name,
      externalRef: row.external_ref, organizationId: row.organization_id, status: row.status,
      dissolvedAt: row.dissolved_at, dissolvedBy: row.dissolved_by, metadata: row.metadata,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
      legalEntity: row.legal_entity, locationUnit: row.location_unit,
    }});
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
