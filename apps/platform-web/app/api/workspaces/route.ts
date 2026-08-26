import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { WorkspaceSection } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository } from '../../../lib/iam-adapter';

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
    // In a real flow, you'd extract tenantId/orgId from headers, query string, or claims.
    // For now we use the default mock tenant to prove the DB mapping works.
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: 'tnt_dreamware',
        organizationId: 'org_dreamware'
      }
    );

    // If it resolves without throwing, the user is mapped correctly!
    const workspaces: WorkspaceSection[] = [
      { id: 'ws_live_platform', label: `Platform Operations (${effectiveContext.subjectId})`, short: 'Platform', href: '/dashboard' },
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
