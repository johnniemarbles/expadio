import { NextResponse } from 'next/server';
import { validateCaseStatus, validateCasePriority, CaseValidationError } from '@expadio/case';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import { toCase } from '../route';

/**
 * Update a case's status and/or priority (governed). RLS keeps the update within
 * the caller's tenant; a governing role is required to mutate.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const caseId = decodeURIComponent((await params).id);
    const body = await request.json();

    let status: string | null = null;
    let priority: string | null = null;
    try {
      if (body.status !== undefined) status = validateCaseStatus(body.status);
      if (body.priority !== undefined) priority = validateCasePriority(body.priority);
    } catch (error) {
      if (error instanceof CaseValidationError) {
        return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
      }
      throw error;
    }
    if (status === null && priority === null) {
      return NextResponse.json({ error: 'Provide a status and/or priority to update.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const updated = await client.query(
        `UPDATE platform.crm_cases
            SET status = COALESCE($2, status),
                priority = COALESCE($3, priority),
                updated_at = now()
          WHERE case_id = $1::uuid
          RETURNING case_id, tenant_id, account_id, contact_id, subject, description, priority, status,
                    blueprint_key, workflow_instance_id, stage_key, owner_subject_id, created_at, updated_at`,
        [caseId, status, priority],
      );
      if (updated.rows.length === 0) return { notFound: true } as const;
      return { case: toCase(updated.rows[0]) } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to update cases.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That case was not found in this workspace.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, case: result.case });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
