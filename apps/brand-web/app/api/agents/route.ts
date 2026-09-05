import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction, hasBrandAdministrationRole } from '../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const rows = await withBrandTransaction(context, async (client) => {
      const res = await client.query(
        `SELECT b.binding_id, c.capability_key, b.mode AS mapped_to_resource,
                COALESCE(s.state, 'NOT_CONFIGURED') AS status, b.created_at
           FROM platform.tenant_capability_bindings b
           JOIN platform.capabilities c ON b.capability_id = c.capability_id
           LEFT JOIN platform.capability_state s ON b.binding_id = s.binding_id
          WHERE b.tenant_id = $1
          ORDER BY b.created_at DESC`,
        [context.tenantId]
      );
      return res.rows;
    });
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await resolveBrandContext();
    const url = new URL(request.url);
    const binding_id = url.searchParams.get('id');
    if (!binding_id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

    await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandAdministrationRole(client, context.subjectId))) throw new Error('FORBIDDEN');
      await client.query(
        'DELETE FROM platform.tenant_capability_bindings WHERE binding_id = $1 AND tenant_id = $2',
        [binding_id, context.tenantId]
      );
    });

    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = msg === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: msg }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
