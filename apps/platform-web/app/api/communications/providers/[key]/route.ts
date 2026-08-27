import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../../lib/iam-adapter';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  const resolvedParams = await params;
  const connectorKey = decodeURIComponent(resolvedParams.key);

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const body = await request.json();
    const { enabled, health } = body;

    const result = await dbPool.query(
      `UPDATE platform.connectors
       SET
         enabled = COALESCE($1, enabled),
         health = COALESCE($2, health),
         updated_at = NOW()
       WHERE connector_key = $3
         AND (tenant_id IS NULL OR tenant_id = $4::uuid)
       RETURNING connector_key, provider_type, provider_key, health, enabled, updated_at`,
      [enabled !== undefined ? Boolean(enabled) : null, health || null, connectorKey, effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, connector: result.rows[0] });
  } catch (err: any) {
    console.error('Connector status update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' }, { status: 401 });
  const connectorKey = decodeURIComponent((await params).key);
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' },
    );
    const result = await dbPool.query(
      `UPDATE platform.connectors
          SET enabled = false, health = 'DEGRADED', updated_at = NOW()
        WHERE connector_key = $1
          AND ownership_scope = 'PLATFORM'
          AND tenant_id IS NULL
        RETURNING connector_key, enabled, health, updated_at`,
      [connectorKey],
    );
    if (result.rows.length === 0) return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
    return NextResponse.json({ success: true, connector: result.rows[0] });
  } catch (err: any) {
    console.error('Connector retirement error:', err);
    return NextResponse.json({ error: err.message || 'Provider retirement failed.' }, { status: 500 });
  }
}
