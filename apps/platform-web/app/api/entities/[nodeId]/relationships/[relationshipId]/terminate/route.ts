import { NextResponse } from 'next/server';
import { deniedResponse, requireStepUp, resolveRequestContext, withTenantTransaction } from '../../../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ nodeId: string; relationshipId: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();
    const { nodeId, relationshipId } = await params;
    const body = await request.json().catch(() => ({})) as { effectiveTo?: unknown };
    const effectiveTo = typeof body.effectiveTo === 'string' ? body.effectiveTo : new Date().toISOString().slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) return NextResponse.json({ error: 'INVALID_EFFECTIVE_TO' }, { status: 400 });
    const result = await withTenantTransaction(context, (client) => client.query(
      `UPDATE platform.entity_relationships
          SET status='TERMINATED',effective_to=$5::date,valid_until=GREATEST($5::date::timestamptz,valid_from + interval '1 second'),
              updated_by_subject_id=$4,updated_at=now()
        WHERE tenant_id=$1::uuid AND relationship_id=$2::uuid
          AND (source_node_id=$3::uuid OR target_node_id=$3::uuid)
          AND status='ACTIVE' AND effective_to IS NULL
        RETURNING relationship_id,status,effective_to`,
      [context.tenantId, relationshipId, nodeId, context.subjectId, effectiveTo],
    ));
    if (!result.rows[0]) {
      const exists = await withTenantTransaction(context, (client) => client.query(
        'SELECT status FROM platform.entity_relationships WHERE tenant_id=$1::uuid AND relationship_id=$2::uuid',
        [context.tenantId, relationshipId],
      ));
      return NextResponse.json({ error: exists.rows[0] ? 'RELATIONSHIP_ALREADY_TERMINATED' : 'RELATIONSHIP_NOT_FOUND' }, { status: exists.rows[0] ? 409 : 404 });
    }
    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
