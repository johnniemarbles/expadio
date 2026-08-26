import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { CapabilitySummary } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002'
      }
    );

    const result = await dbPool.query(
      `SELECT b.binding_id, c.display_name, c.capability_key, s.state, s.resolved_at 
       FROM platform.capability_state s
       JOIN platform.tenant_capability_bindings b ON s.binding_id = b.binding_id AND s.tenant_id = b.tenant_id
       JOIN platform.capabilities c ON b.capability_id = c.capability_id
       WHERE s.tenant_id = $1 AND s.state = 'ACTIVE'`,
      [effectiveContext.tenantId]
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

    // If there are no capabilities in DB yet, fallback to dummy data for development
    if (capabilities.length === 0) {
      return NextResponse.json([
        { id: 'cap_live_1', name: 'Live Incident Response', kind: 'Worker', version: '2.0.1', state: 'Published', scope: 'Global', updated: '2026-08-26T10:00:00Z' },
        { id: 'cap_live_2', name: 'Compliance Auditing', kind: 'Skill', version: '1.4.0', state: 'Review', scope: 'EU-Region', updated: '2026-08-25T14:30:00Z' }
      ] as CapabilitySummary[]);
    }

    return NextResponse.json(capabilities);
  } catch (error: any) {
    console.error("Capabilities API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const body = await request.json();
    const { id, action } = body;
    
    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
    }

    const newState = action === 'publish' ? 'ACTIVE' : 'SUSPENDED';

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      
      const res = await client.query(
        `UPDATE platform.capability_state SET state = $1, resolved_at = NOW(), version = version + 1 
         WHERE binding_id = $2 AND tenant_id = $3 RETURNING input_hash, state, reason_key`,
        [newState, id, effectiveContext.tenantId]
      );
      
      if (res.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
      }

      // Insert audit event
      const updatedRow = res.rows[0];
      await client.query(
        `INSERT INTO platform.capability_state_events (binding_id, tenant_id, from_state, to_state, reason_key, input_hash, occurred_at)
         VALUES ($1, $2, 'UNKNOWN', $3, 'UI_MUTATION', $4, NOW())`,
        [id, effectiveContext.tenantId, newState, updatedRow.input_hash]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, id, state: newState === 'ACTIVE' ? 'Published' : 'Review' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Capabilities POST API Error:", error);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'An unknown error occurred.' };
    return NextResponse.json(denied, { status: 500 });
  }
}

