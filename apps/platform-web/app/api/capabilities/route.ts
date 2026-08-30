import { NextResponse } from 'next/server';
import type { CapabilitySummary } from '../../../lib/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await withTenantClient(effectiveContext, (client) =>
      client.query(
        `SELECT b.binding_id, c.display_name, c.capability_key, s.state, s.resolved_at 
         FROM platform.capability_state s
         JOIN platform.tenant_capability_bindings b ON s.binding_id = b.binding_id AND s.tenant_id = b.tenant_id
         JOIN platform.capabilities c ON b.capability_id = c.capability_id
         WHERE s.tenant_id = $1 AND s.state = 'ACTIVE'`,
        [effectiveContext.tenantId]
      )
    );

    const capabilities: CapabilitySummary[] = result.rows.map((row: any) => ({
      id: row.binding_id,
      name: row.display_name || 'Governed Capability',
      kind: 'Worker',
      version: '1.0.0',
      state: row.state === 'ACTIVE' ? 'Published' : 'Review',
      scope: 'Global',
      updated: row.resolved_at ? new Date(row.resolved_at).toLocaleString() : new Date().toLocaleString(),
    }));

    return NextResponse.json(capabilities);
  } catch (error: any) {
    console.error("Capabilities API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const body = await request.json();
    const { id, action } = body;
    
    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
    }

    const newState = action === 'publish' ? 'ACTIVE' : 'SUSPENDED';

    const result = await withTenantClient(effectiveContext, async (client) => {
      await client.query('BEGIN');
      await effectiveContext.applyTo(client);
      try {
        const res = await client.query(
          `UPDATE platform.capability_state SET state = $1, resolved_at = NOW(), version = version + 1 
           WHERE binding_id = $2 AND tenant_id = $3 RETURNING input_hash, state, reason_key`,
          [newState, id, effectiveContext.tenantId]
        );
        
        if (res.rowCount === 0) {
          await client.query('ROLLBACK');
          return { notFound: true as const };
        }

        const updatedRow = res.rows[0];
        await client.query(
          `INSERT INTO platform.capability_state_events (binding_id, tenant_id, from_state, to_state, reason_key, input_hash, occurred_at)
           VALUES ($1, $2, 'UNKNOWN', $3, 'UI_MUTATION', $4, NOW())`,
          [id, effectiveContext.tenantId, newState, updatedRow.input_hash]
        );

        await client.query('COMMIT');
        return { notFound: false as const };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if (result.notFound) {
      return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id, state: newState === 'ACTIVE' ? 'Published' : 'Review' });
  } catch (error: any) {
    console.error("Capabilities POST API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

