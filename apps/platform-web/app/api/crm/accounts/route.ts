import { NextResponse } from 'next/server';
import { validateAccountInput, PartyValidationError, type CrmAccount } from '@expadio/party';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';

/**
 * CRM accounts (customer organizations). Tenant-scoped via RLS; reads require
 * membership, writes require a governing role. The response never leaks another
 * tenant's rows — isolation is enforced by the crm_accounts RLS policy.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toAccount(row: any): CrmAccount {
  return {
    accountId: row.account_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id ?? null,
    name: row.name,
    domain: row.domain ?? null,
    industry: row.industry ?? null,
    lifecycleStage: row.lifecycle_stage,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';

    const accounts = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT account_id, tenant_id, organization_id, name, domain, industry,
                lifecycle_stage, status, created_at, updated_at
           FROM platform.crm_accounts
          WHERE status <> 'ARCHIVED'
            AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR domain ILIKE '%' || $1 || '%')
          ORDER BY created_at DESC
          LIMIT 200`,
        [q],
      );
      return result.rows.map(toAccount);
    });

    return NextResponse.json(accounts);
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
      input = validateAccountInput(await request.json());
    } catch (error) {
      if (error instanceof PartyValidationError) {
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
          `INSERT INTO platform.crm_accounts (tenant_id, name, domain, industry, lifecycle_stage)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                     lifecycle_stage, status, created_at, updated_at`,
          [context.tenantId, input.name, input.domain, input.industry, input.lifecycleStage],
        );
        return { account: toAccount(inserted.rows[0]) } as const;
      } catch (err: any) {
        if (err?.code === '23505') return { duplicate: true } as const;
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to create accounts.' }, { status: 403 });
    }
    if ('duplicate' in result) {
      return NextResponse.json({ error: 'An account with that domain already exists in this workspace.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, account: result.account }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
