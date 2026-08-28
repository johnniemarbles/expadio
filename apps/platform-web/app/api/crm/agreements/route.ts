import { NextResponse } from 'next/server';
import { validateAgreementInput, AgreementValidationError, type CrmAgreement } from '@expadio/agreement';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';

/**
 * CRM agreements (contracts/subscriptions with customers). Tenant-scoped via
 * RLS; reads require membership, writes require a governing role. Backed by the
 * @expadio/agreement domain.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function toAgreement(row: any): CrmAgreement & { accountName: string | null } {
  return {
    agreementId: row.agreement_id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    sourceLeadId: row.source_lead_id ?? null,
    title: row.title,
    status: row.status,
    valueMinorUnits: row.value_minor_units === null || row.value_minor_units === undefined ? null : Number(row.value_minor_units),
    currency: row.currency,
    startsOn: row.starts_on ? new Date(row.starts_on).toISOString().slice(0, 10) : null,
    endsOn: row.ends_on ? new Date(row.ends_on).toISOString().slice(0, 10) : null,
    ownerSubjectId: row.owner_subject_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    accountName: row.account_name ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status')?.trim().toUpperCase() ?? '';
    const accountId = url.searchParams.get('accountId')?.trim() ?? '';

    const agreements = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT g.agreement_id, g.tenant_id, g.account_id, g.source_lead_id, g.title, g.status,
                g.value_minor_units, g.currency, g.starts_on, g.ends_on, g.owner_subject_id,
                g.created_at, g.updated_at, a.name AS account_name
           FROM platform.crm_agreements g
           JOIN platform.crm_accounts a ON a.account_id = g.account_id
          WHERE ($1 = '' OR g.status = $1)
            AND ($2 = '' OR g.account_id = $2::uuid)
          ORDER BY g.created_at DESC
          LIMIT 200`,
        [status, accountId],
      );
      return result.rows.map(toAgreement);
    });

    return NextResponse.json(agreements);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    let input;
    try {
      input = validateAgreementInput(await request.json());
    } catch (error) {
      if (error instanceof AgreementValidationError) {
        return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
      }
      throw error;
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      try {
        const inserted = await client.query(
          `INSERT INTO platform.crm_agreements
             (tenant_id, account_id, source_lead_id, title, status, value_minor_units, currency, starts_on, ends_on, owner_subject_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING agreement_id, tenant_id, account_id, source_lead_id, title, status,
                     value_minor_units, currency, starts_on, ends_on, owner_subject_id, created_at, updated_at`,
          [
            context.tenantId, input.accountId, input.sourceLeadId, input.title, input.status,
            input.valueMinorUnits, input.currency, input.startsOn, input.endsOn, context.subjectId,
          ],
        );
        return { agreement: toAgreement(inserted.rows[0]) } as const;
      } catch (err: any) {
        if (err?.code === '23503') return { badRef: true } as const;
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to create agreements.' }, { status: 403 });
    }
    if ('badRef' in result) {
      return NextResponse.json({ error: 'The linked account does not exist in this workspace.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, agreement: result.agreement }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
