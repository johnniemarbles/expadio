import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';
import { dbPool } from '../../../../lib/iam-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const locationId = searchParams.get('locationId');
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 100);
    const values: unknown[] = [context.tenantId];
    const filters = ['tenant_id = $1'];
    if (status) { values.push(status); filters.push(`status = $${values.length}`); }
    if (locationId) { values.push(locationId); filters.push(`location_id = $${values.length}`); }
    values.push(limit);
    const result = await dbPool.query(
      `SELECT work_item_id, organization_id, location_id, subject_type, subject_id, title,
              work_type, status, maker_subject_id, assignee_subject_id, due_at,
              correlation_id, created_at, updated_at
         FROM platform.tenant_work_items
        WHERE ${filters.join(' AND ')}
        ORDER BY CASE WHEN status IN ('AWAITING_REVIEW','FAILED','OUTCOME_UNCERTAIN') THEN 0 ELSE 1 END,
                 due_at NULLS LAST, created_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return NextResponse.json(result.rows);
  } catch (error: any) {
    if (error?.denied) { const { body, status } = deniedResponse(error); return NextResponse.json(body, { status }); }
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error?.message || 'Unable to load tenant work.' };
    return NextResponse.json(denied, { status: 500 });
  }
}
