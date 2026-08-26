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
      `SELECT binding_id, state, resolved_at 
       FROM platform.capability_state 
       WHERE tenant_id = $1 AND state = 'ACTIVE'`,
      [effectiveContext.tenantId]
    );

    const capabilities: CapabilitySummary[] = result.rows.map((row: any) => ({
      id: row.binding_id,
      name: 'Governed Capability',
      kind: 'Worker',
      version: '1.0.0',
      state: row.state === 'ACTIVE' ? 'Published' : 'Review',
      scope: 'Global',
      updated: row.resolved_at || new Date().toISOString(),
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
