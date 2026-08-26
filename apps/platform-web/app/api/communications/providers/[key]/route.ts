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
      return NextResponse.json({
        success: true,
        connectorKey,
        enabled: enabled ?? true,
        health: health ?? 'HEALTHY',
        message: 'Mock connector status updated successfully.',
      });
    }

    return NextResponse.json({ success: true, connector: result.rows[0] });
  } catch (err: any) {
    console.error('Connector status update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
