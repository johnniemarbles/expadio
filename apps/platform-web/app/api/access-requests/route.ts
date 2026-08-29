import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../lib/governance-authz';

/**
 * Access requests — the fourth governed vertical. Tenant-scoped via RLS; reads
 * require membership, writes require a governing role. GET lists the tenant's
 * requests; POST files one in SUBMITTED, bound to the access.request blueprint.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface AccessRequestRow {
  readonly accessRequestId: string;
  readonly resource: string;
  readonly justification: string | null;
  readonly status: string;
  readonly blueprintKey: string | null;
  readonly workflowInstanceId: string | null;
  readonly stageKey: string | null;
  readonly createdAt: string;
}

function toRow(row: any): AccessRequestRow {
  return {
    accessRequestId: row.access_request_id,
    resource: row.resource,
    justification: row.justification ?? null,
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
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT access_request_id, resource, justification, status, blueprint_key,
                workflow_instance_id, stage_key, created_at
           FROM platform.access_requests
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return result.rows.map(toRow);
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const resource = typeof body?.resource === 'string' ? body.resource.trim() : '';
    if (resource === '' || resource.length > 200) {
      return NextResponse.json({ error: 'A resource (1–200 characters) is required.' }, { status: 400 });
    }
    const justification = typeof body?.justification === 'string' && body.justification.trim() !== '' ? body.justification.trim() : null;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const inserted = await client.query(
          `INSERT INTO platform.access_requests (tenant_id, requester_subject_id, resource, justification, status, blueprint_key)
           VALUES ($1::uuid, $2, $3, $4, 'SUBMITTED', 'access.request')
           RETURNING access_request_id`,
          [context.tenantId, context.subjectId, resource, justification],
        );
        await client.query('COMMIT');
        return { accessRequestId: inserted.rows[0].access_request_id as string } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to file an access request.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, accessRequestId: result.accessRequestId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
