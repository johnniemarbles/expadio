import { NextResponse } from 'next/server';
import { deniedResponse, requireStepUp, resolveRequestContext, withTenantTransaction } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();
    const { nodeId } = await params;
    const result = await withTenantTransaction(context, (client) => client.query(
      `UPDATE platform.entity_nodes SET status='DISSOLVED',dissolved_at=now(),dissolved_by=$3,updated_at=now()
        WHERE tenant_id=$1::uuid AND node_id=$2::uuid AND status<>'DISSOLVED'
        RETURNING node_id,status,dissolved_at,dissolved_by`,
      [context.tenantId, nodeId, context.subjectId],
    ));
    if (!result.rows[0]) {
      const exists = await withTenantTransaction(context, (client) => client.query(
        'SELECT status FROM platform.entity_nodes WHERE tenant_id=$1::uuid AND node_id=$2::uuid',
        [context.tenantId, nodeId],
      ));
      return NextResponse.json(
        { error: exists.rows[0] ? 'NODE_ALREADY_DISSOLVED' : 'NODE_NOT_FOUND' },
        { status: exists.rows[0] ? 409 : 404 },
      );
    }
    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
