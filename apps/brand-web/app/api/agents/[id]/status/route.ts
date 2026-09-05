import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction, hasBrandAdministrationRole } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveBrandContext();
    const binding_id = (await params).id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';

    const state = action === 'activate' ? 'ACTIVE' : action === 'suspend' ? 'SUSPENDED' : null;
    if (!state) return NextResponse.json({ error: 'action must be activate or suspend' }, { status: 400 });

    await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandAdministrationRole(client, context.subjectId))) throw new Error('FORBIDDEN');
      await client.query(
        `INSERT INTO platform.capability_state (binding_id, state, updated_at)
         SELECT $1, $2, NOW() FROM platform.tenant_capability_bindings
          WHERE binding_id = $1 AND tenant_id = $3
         ON CONFLICT (binding_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
        [binding_id, state, context.tenantId]
      );
    });

    return NextResponse.json({ success: true, state }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = msg === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: msg }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
