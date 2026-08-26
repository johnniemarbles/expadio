import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { WorkspaceSection } from '../../../lib/contracts';
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

  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    {
      credential: userId,
      tenantId: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002'
    }
  );

  try {
    let effectiveContext;
    try {
      effectiveContext = await resolve();
    } catch (error) {
      // Auto-provision user if they aren't in the database yet
      console.log(`Auto-provisioning user ${userId} in database...`);
      const client = await dbPool.connect();
      try {
        const res = await client.query('SELECT membership_id FROM platform.memberships WHERE subject_id = $1', [userId]);
        if (res.rowCount === 0) {
          await client.query(
            `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
             VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', $1, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')`,
            [userId]
          );
        } else {
          await client.query("UPDATE platform.memberships SET issuer = 'https://clerk.expadio.com' WHERE subject_id = $1", [userId]);
        }
      } finally {
        client.release();
      }
      effectiveContext = await resolve();
    }

    const workspaces: WorkspaceSection[] = [
      { id: 'ws_live_platform', label: `Platform Operations (${effectiveContext.subjectId.slice(-4)})`, short: 'Platform', href: '/dashboard' },
      { id: 'ws_live_brain', label: 'Knowledge Brain', short: 'Brain', href: '/brain' },
      { id: 'ws_live_security', label: 'Security Center', short: 'Security', href: '/security' }
    ];
    return NextResponse.json(workspaces);
  } catch (error) {
    console.error("IAM Resolution Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHORIZED_OR_UNMAPPED',
      message: 'Could not resolve internal EXPADIO identity for this user.'
    };
    return NextResponse.json(denied, { status: 403 });
  }
}
