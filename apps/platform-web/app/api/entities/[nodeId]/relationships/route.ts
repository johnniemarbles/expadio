import { NextResponse } from 'next/server';
import { RELATIONSHIP_TYPES, validateCreateRelationship, type RelationshipType } from '@expadio/entity';
import { deniedResponse, requireStepUp, resolveRequestContext, withTenantTransaction } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const { nodeId } = await params;
    const url = new URL(request.url);
    const direction = url.searchParams.get('direction');
    const type = url.searchParams.get('type');
    if (direction && !['source','target'].includes(direction)) return NextResponse.json({ error: 'INVALID_DIRECTION' }, { status: 400 });
    if (type && !RELATIONSHIP_TYPES.includes(type as RelationshipType)) return NextResponse.json({ error: 'INVALID_RELATIONSHIP_TYPE' }, { status: 400 });
    const result = await withTenantTransaction(context, (client) => client.query(
      `SELECT relationship_id,source_node_id,target_node_id,relationship_type,effective_from,
              effective_to,status,evidence_ref,approved_by,created_by_subject_id,notes,created_at
         FROM platform.entity_relationships
        WHERE tenant_id=$1::uuid AND status='ACTIVE' AND effective_to IS NULL
          AND ($3::text IS NULL OR relationship_type=$3)
          AND (($2='source' AND source_node_id=$4::uuid)
            OR ($2='target' AND target_node_id=$4::uuid)
            OR ($2 IS NULL AND (source_node_id=$4::uuid OR target_node_id=$4::uuid)))
        ORDER BY effective_from DESC`,
      [context.tenantId, direction, type, nodeId],
    ));
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();
    const { nodeId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const input = {
      tenantId: context.tenantId, sourceNodeId: nodeId,
      targetNodeId: body.targetNodeId as string,
      relationshipType: body.relationshipType as RelationshipType,
      ...(typeof body.effectiveFrom === 'string' ? { effectiveFrom: body.effectiveFrom } : {}),
      ...(typeof body.evidenceRef === 'string' ? { evidenceRef: body.evidenceRef } : {}),
      ...(typeof body.approvedBy === 'string' ? { approvedBy: body.approvedBy } : {}),
      ...(body.notes && typeof body.notes === 'object' ? { notes: body.notes as Record<string, unknown> } : {}),
      createdBy: context.subjectId,
    };
    const errors = validateCreateRelationship(input);
    if (errors.length) return NextResponse.json({ error: 'INVALID_RELATIONSHIP', details: errors }, { status: 400 });
    const result = await withTenantTransaction(context, async (client) => {
      if (input.relationshipType === 'GOVERNANCE_PARENT') {
        const nodes = await client.query(
          'SELECT node_type FROM platform.entity_nodes WHERE tenant_id=$1::uuid AND node_id=ANY($2::uuid[])',
          [context.tenantId, [input.sourceNodeId, input.targetNodeId]],
        );
        if (nodes.rows.some((row) => row.node_type === 'BRAND_HQ') && !input.approvedBy) {
          throw Object.assign(new Error('APPROVAL_REQUIRED'), { status: 400 });
        }
      }
      return client.query(
        `INSERT INTO platform.entity_relationships (
          tenant_id,source_entity_type,source_entity_id,relationship_key,target_entity_type,target_entity_id,
          status,valid_from,provenance_source,created_by_subject_id,source_node_id,target_node_id,
          relationship_type,effective_from,evidence_ref,approved_by,notes)
         VALUES ($1::uuid,'ENTITY_NODE',$2,$4,'ENTITY_NODE',$3,'ACTIVE',now(),'USER',$5,$2::uuid,$3::uuid,
                 $4,$6::date,$7,$8,$9::jsonb) RETURNING *`,
        [context.tenantId,input.sourceNodeId,input.targetNodeId,input.relationshipType,context.subjectId,
         input.effectiveFrom ?? new Date().toISOString().slice(0,10),input.evidenceRef ?? null,
         input.approvedBy ?? null,JSON.stringify(input.notes ?? {})],
      );
    });
    return NextResponse.json({ item: result.rows[0] }, { status: 201 });
  } catch (error) {
    if ((error as Error).message.includes('APPROVAL_REQUIRED')) return NextResponse.json({ error: 'APPROVAL_REQUIRED' }, { status: 400 });
    if ((error as { code?: string }).code === '23514' || (error as Error).message.includes('Cardinality violation')) {
      return NextResponse.json({ error: 'RELATIONSHIP_CARDINALITY_VIOLATION', message: 'This node already has an active relationship of this type. Terminate it before adding a new one.' }, { status: 409 });
    }
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
