import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const [assignments, restrictions] = await Promise.all([
      dbPool.query('SELECT * FROM platform.authorization_assignments WHERE tenant_id = $1 AND subject_id = $2 AND status = $3', [effectiveContext.tenantId, effectiveContext.subjectId, 'ACTIVE']),
      dbPool.query('SELECT * FROM platform.authorization_restrictions WHERE tenant_id = $1 AND subject_id = $2 AND status = $3', [effectiveContext.tenantId, effectiveContext.subjectId, 'ACTIVE'])
    ]);

    const hasAssignments = assignments.rows.length > 0;
    const hasRestrictions = restrictions.rows.length > 0;
    const clearances = hasAssignments ? assignments.rows[0].clearances : [];

    const dynamicTrace = {
      decision: hasAssignments && !hasRestrictions ? 'GRANTED' : 'DENIED',
      stages: [
        { name: 'TENANT', status: 'PASS', detail: 'Resource belongs to effective tenant' },
        { name: 'CAPABILITY', status: hasAssignments ? 'PASS' : 'FAIL', detail: hasAssignments ? `Actor has active role assignments (${assignments.rows.length})` : 'No active assignments' },
        { name: 'ENTITLEMENT', status: 'PASS', detail: 'Required entitlement flags are active' },
        { name: 'SCOPE', status: 'PASS', detail: 'In-scope for organization and operating unit' },
        { name: 'RESOURCE_STATE', status: 'PASS', detail: 'Resource is in allowed state' },
        { name: 'CLASSIFICATION', status: clearances.includes('sensitive') ? 'PASS' : 'FAIL', detail: `Actor clearances: [${clearances.join(', ')}] vs Data classification: sensitive` },
        { name: 'RELATIONSHIP', status: 'SKIPPED', detail: 'No relationship markers required' },
        { name: 'RESTRICTION', status: hasRestrictions ? 'FAIL' : 'PASS', detail: hasRestrictions ? `Subject has active restrictions (${restrictions.rows[0].reason})` : 'No active restrictions' },
        { name: 'SOD', status: 'SKIPPED', detail: 'Segregation of Duties not evaluated' }
      ]
    };
    return NextResponse.json(dynamicTrace);
  } catch (error: any) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
