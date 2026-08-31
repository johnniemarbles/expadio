import { NextResponse } from 'next/server';
import { validateLeadInput, LeadValidationError, type CrmLead } from '@expadio/lead';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';

/**
 * CRM leads (sales pipeline). Tenant-scoped via RLS; reads require membership,
 * writes require a governing role. Backed by the @expadio/lead domain.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function toLead(row: any): CrmLead & { accountName: string | null } {
  const payload = row.raw_payload;
  return {
    leadId: row.lead_id,
    tenantId: row.tenant_id,
    accountId: row.account_id ?? null,
    contactId: row.contact_id ?? null,
    title: row.title,
    stage: row.stage,
    amountMinorUnits: row.amount_minor_units === null || row.amount_minor_units === undefined ? null : Number(row.amount_minor_units),
    currency: row.currency,
    source: row.source ?? null,
    rawPayload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
    ownerSubjectId: row.owner_subject_id ?? null,
    captureLeadId: row.capture_lead_id ?? null,
    captureLayerId: row.capture_layer_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    accountName: row.account_name ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const stage = url.searchParams.get('stage')?.trim().toUpperCase() ?? '';
    const accountId = url.searchParams.get('accountId')?.trim() ?? '';

    const leads = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT l.lead_id, l.tenant_id, l.account_id, l.contact_id, l.title, l.stage,
                l.amount_minor_units, l.currency, l.source, l.raw_payload, l.owner_subject_id,
                l.capture_lead_id, l.capture_layer_id, l.created_at, l.updated_at, a.name AS account_name
           FROM platform.crm_leads l
           LEFT JOIN platform.crm_accounts a ON a.account_id = l.account_id
          WHERE ($1 = '' OR l.stage = $1)
            AND ($2 = '' OR l.account_id = $2::uuid)
          ORDER BY l.created_at DESC
          LIMIT 200`,
        [stage, accountId],
      );
      return result.rows.map(toLead);
    });

    return NextResponse.json(leads);
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
      input = validateLeadInput(await request.json());
    } catch (error) {
      if (error instanceof LeadValidationError) {
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
          `INSERT INTO platform.crm_leads
             (tenant_id, account_id, contact_id, title, stage, amount_minor_units, currency, source, raw_payload, owner_subject_id)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           RETURNING lead_id, tenant_id, account_id, contact_id, title, stage,
                     amount_minor_units, currency, source, raw_payload, owner_subject_id,
                     capture_lead_id, capture_layer_id, created_at, updated_at`,
          [
            context.tenantId, input.accountId, input.contactId, input.title, input.stage,
            input.amountMinorUnits, input.currency, input.source, JSON.stringify(input.rawPayload), context.subjectId,
          ],
        );
        return { lead: toLead(inserted.rows[0]) } as const;
      } catch (err: any) {
        if (err?.code === '23503') return { badRef: true } as const;
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to create leads.' }, { status: 403 });
    }
    if ('badRef' in result) {
      return NextResponse.json({ error: 'The linked account or contact does not exist in this workspace.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, lead: result.lead }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
