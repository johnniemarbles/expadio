import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { resolveRequestContext, deniedResponse } from '../../../../../lib/request-context';
import { dbPool } from '../../../../../lib/iam-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const { id } = await params;
    const result = await dbPool.query(
      `SELECT c.contact_id AS customer_id, c.full_name AS name, c.email, c.phone,
              c.status, c.account_id, a.name AS account_name,
              c.created_at, c.updated_at
         FROM platform.crm_contacts c
         LEFT JOIN platform.crm_accounts a ON a.account_id = c.account_id AND a.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.contact_id = $2 AND c.status <> 'ARCHIVED'`,
      [context.tenantId, id],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    return NextResponse.json({ ...result.rows[0], tabs: ['overview', 'activity', 'tasks', 'communications', 'documents', 'decisions'] });
  } catch (error: any) {
    if (error?.denied) { const { body, status } = deniedResponse(error); return NextResponse.json(body, { status }); }
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error?.message || 'Unable to load customer.' };
    return NextResponse.json(denied, { status: 500 });
  }
}
