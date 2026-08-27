import { NextResponse } from 'next/server';
import { resolveRequestContext, deniedResponse, withTenantClient } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const context = await resolveRequestContext();
    const connectorKey = decodeURIComponent((await params).key);
    const body = await request.json();
    const { enabled, health } = body;
    if (enabled !== undefined && typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be a boolean.' }, { status: 400 });
    if (health !== undefined && typeof health !== 'string') return NextResponse.json({ error: 'health must be a string.' }, { status: 400 });

    return await withTenantClient(context, async (client) => {
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = COALESCE($1, enabled),
                health = COALESCE($2, health),
                updated_at = NOW()
          WHERE connector_key = $3
            AND ownership_scope = 'PLATFORM'
            AND tenant_id IS NULL
          RETURNING connector_key, provider_type, provider_key, health, enabled, updated_at`,
        [enabled !== undefined ? enabled : null, health || null, connectorKey]
      );
      if (!result.rows.length) return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
      return NextResponse.json({ success: true, connector: result.rows[0] });
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Connector status update error:', err);
    return NextResponse.json({ error: err.message || 'Connector status update failed.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext();
    const connectorKey = decodeURIComponent((await params).key);
    return await withTenantClient(context, async (client) => {
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = false, health = 'DEGRADED', updated_at = NOW()
          WHERE connector_key = $1
            AND ownership_scope = 'PLATFORM'
            AND tenant_id IS NULL
          RETURNING connector_key, enabled, health, updated_at`,
        [connectorKey],
      );
      if (!result.rows.length) return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
      return NextResponse.json({ success: true, connector: result.rows[0] });
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Connector retirement error:', err);
    return NextResponse.json({ error: err.message || 'Provider retirement failed.' }, { status: 500 });
  }
}
