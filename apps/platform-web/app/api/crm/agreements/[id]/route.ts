import { NextResponse } from 'next/server';
import { validateAgreementStatus, AgreementValidationError } from '@expadio/agreement';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import { toAgreement } from '../route';

/**
 * Move an agreement through its lifecycle (governed). RLS keeps the update
 * within the caller's tenant; a governing role is required to mutate.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const agreementId = decodeURIComponent((await params).id);
    const body = await request.json();

    let status;
    try {
      status = validateAgreementStatus(body.status);
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
      const updated = await client.query(
        `UPDATE platform.crm_agreements
            SET status = $2, updated_at = now()
          WHERE agreement_id = $1::uuid
          RETURNING agreement_id, tenant_id, account_id, source_lead_id, title, status,
                    value_minor_units, currency, starts_on, ends_on, owner_subject_id, created_at, updated_at`,
        [agreementId, status],
      );
      if (updated.rows.length === 0) return { notFound: true } as const;
      return { agreement: toAgreement(updated.rows[0]) } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to update agreements.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That agreement was not found in this workspace.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, agreement: result.agreement });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
