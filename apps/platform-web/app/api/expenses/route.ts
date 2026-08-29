import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../lib/governance-authz';

/**
 * Expense reimbursements — a third governed vertical on the Decision Fabric.
 * Tenant-scoped via RLS; reads require membership, writes require a governing
 * role. GET lists the tenant's expenses; POST files one in SUBMITTED, bound to
 * the expense.reimbursement blueprint so its workflow can be started.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ExpenseRow {
  readonly expenseId: string;
  readonly purpose: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly status: string;
  readonly blueprintKey: string | null;
  readonly workflowInstanceId: string | null;
  readonly stageKey: string | null;
  readonly createdAt: string;
}

function toExpense(row: any): ExpenseRow {
  return {
    expenseId: row.expense_id,
    purpose: row.purpose,
    amountMinorUnits: Number(row.amount_minor_units),
    currency: row.currency,
    status: row.status,
    blueprintKey: row.blueprint_key ?? null,
    workflowInstanceId: row.workflow_instance_id ?? null,
    stageKey: row.stage_key ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const expenses = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT expense_id, purpose, amount_minor_units, currency, status, blueprint_key,
                workflow_instance_id, stage_key, created_at
           FROM platform.expense_reports
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return result.rows.map(toExpense);
    });
    return NextResponse.json(expenses);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const purpose = typeof body?.purpose === 'string' ? body.purpose.trim() : '';
    if (purpose === '' || purpose.length > 200) {
      return NextResponse.json({ error: 'A purpose (1–200 characters) is required.' }, { status: 400 });
    }
    const amountMinorUnits = Number(body?.amountMinorUnits);
    if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
      return NextResponse.json({ error: 'A positive amount (in minor units) is required.' }, { status: 400 });
    }
    const currency = typeof body?.currency === 'string' && body.currency.trim() !== '' ? body.currency.trim().toUpperCase() : 'USD';

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const inserted = await client.query(
          `INSERT INTO platform.expense_reports (tenant_id, employee_subject_id, purpose, amount_minor_units, currency, status, blueprint_key)
           VALUES ($1::uuid, $2, $3, $4, $5, 'SUBMITTED', 'expense.reimbursement')
           RETURNING expense_id`,
          [context.tenantId, context.subjectId, purpose, amountMinorUnits, currency],
        );
        await client.query('COMMIT');
        return { expenseId: inserted.rows[0].expense_id as string } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to file an expense.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, expenseId: result.expenseId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
