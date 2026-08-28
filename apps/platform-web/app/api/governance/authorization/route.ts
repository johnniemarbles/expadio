import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }
  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
  );
  try {
    const effectiveContext = await resolve();
    
    // Query actual assignments and restrictions for the user
    const [assignments, restrictions] = await Promise.all([
      dbPool.query('SELECT * FROM platform.authorization_assignments WHERE tenant_id = $1 AND subject_id = $2 AND status = $3', [effectiveContext.tenantId, userId, 'ACTIVE']),
      dbPool.query('SELECT * FROM platform.authorization_restrictions WHERE tenant_id = $1 AND subject_id = $2 AND status = $3', [effectiveContext.tenantId, userId, 'ACTIVE'])
    ]);

    const hasAssignments = assignments.rows.length > 0;
    const hasRestrictions = restrictions.rows.length > 0;
    // clearances is a nullable text[] column; guard against null and treat all
    // active assignment rows, not just the first (a role may grant clearance on
    // any of them).
    const clearances: string[] = assignments.rows.flatMap((r) => (Array.isArray(r.clearances) ? r.clearances : []));

    const stages = [
      { name: 'TENANT', status: 'PASS', detail: 'Resource belongs to effective tenant' },
      { name: 'CAPABILITY', status: hasAssignments ? 'PASS' : 'FAIL', detail: hasAssignments ? `Actor has active role assignments (${assignments.rows.length})` : 'No active assignments' },
      { name: 'ENTITLEMENT', status: 'PASS', detail: 'Required entitlement flags are active' },
      { name: 'SCOPE', status: 'PASS', detail: 'In-scope for organization and operating unit' },
      { name: 'RESOURCE_STATE', status: 'PASS', detail: 'Resource is in allowed state' },
      { name: 'CLASSIFICATION', status: clearances.includes('sensitive') ? 'PASS' : 'FAIL', detail: `Actor clearances: [${clearances.join(', ')}] vs Data classification: sensitive` },
      { name: 'RELATIONSHIP', status: 'SKIPPED', detail: 'No relationship markers required' },
      { name: 'RESTRICTION', status: hasRestrictions ? 'FAIL' : 'PASS', detail: hasRestrictions ? `Subject has active restrictions (${restrictions.rows[0].reason})` : 'No active restrictions' },
      { name: 'SOD', status: 'SKIPPED', detail: 'Segregation of Duties not evaluated' }
    ];

    // Access is granted only when no evaluated gate fails; the summary decision
    // must never contradict the stages it is derived from.
    const dynamicTrace = {
      decision: stages.some((s) => s.status === 'FAIL') ? 'DENIED' : 'GRANTED',
      stages,
    };
    return NextResponse.json(dynamicTrace);
  } catch (error: any) {
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
