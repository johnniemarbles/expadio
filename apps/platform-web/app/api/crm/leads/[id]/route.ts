import { NextResponse } from 'next/server';
import { validateStage, LeadValidationError } from '@expadio/lead';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import { toLead } from '../route';

/**
 * Move a lead through the pipeline (governed). RLS keeps the update within the
 * caller's tenant; a governing role is required to mutate.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const leadId = decodeURIComponent((await params).id);
    const body = await request.json();

    let stage;
    try {
      stage = validateStage(body.stage);
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
      const updated = await client.query(
        `UPDATE platform.crm_leads
            SET stage = $2, updated_at = now()
          WHERE lead_id = $1::uuid
          RETURNING lead_id, tenant_id, account_id, contact_id, title, stage,
                    amount_minor_units, currency, source, raw_payload, owner_subject_id, created_at, updated_at`,
        [leadId, stage],
      );
      if (updated.rows.length === 0) return { notFound: true } as const;
      return { lead: toLead(updated.rows[0]) } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to move leads.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That lead was not found in this workspace.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, lead: result.lead });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
