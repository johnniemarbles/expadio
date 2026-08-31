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
    const search = searchParams.get('search');
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 200);
    const values: unknown[] = [context.tenantId];
    const filters = ['c.tenant_id = $1', "c.status <> 'ARCHIVED'"];
    if (search) { values.push(`%${search}%`); filters.push(`(c.full_name ILIKE $${values.length} OR c.email ILIKE $${values.length} OR a.name ILIKE $${values.length})`); }
    values.push(limit);
    const result = await dbPool.query(
      `SELECT c.contact_id AS customer_id, c.full_name AS name, c.email, c.phone,
              c.account_id, a.name AS account_name, c.status,
              c.created_at, c.updated_at
         FROM platform.crm_contacts c
         LEFT JOIN platform.crm_accounts a ON a.account_id = c.account_id AND a.tenant_id = c.tenant_id
        WHERE ${filters.join(' AND ')}
        ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return NextResponse.json(result.rows);
  } catch (error: any) {
    if (error?.denied) { const { body, status } = deniedResponse(error); return NextResponse.json(body, { status }); }
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error?.message || 'Unable to load customers.' };
    return NextResponse.json(denied, { status: 500 });
  }
}
