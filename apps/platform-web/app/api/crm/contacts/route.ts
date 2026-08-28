import { NextResponse } from 'next/server';
import { validateContactInput, PartyValidationError, type CrmContact } from '@expadio/party';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';

/**
 * CRM contacts (people), optionally attached to an account. Tenant-scoped via
 * RLS; reads require membership, writes require a governing role.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toContact(row: any): CrmContact & { accountName: string | null } {
  return {
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    accountId: row.account_id ?? null,
    fullName: row.full_name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    title: row.title ?? null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    accountName: row.account_name ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const accountId = url.searchParams.get('accountId')?.trim() ?? '';

    const contacts = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT c.contact_id, c.tenant_id, c.account_id, c.full_name, c.email, c.phone,
                c.title, c.status, c.created_at, c.updated_at, a.name AS account_name
           FROM platform.crm_contacts c
           LEFT JOIN platform.crm_accounts a ON a.account_id = c.account_id
          WHERE c.status <> 'ARCHIVED'
            AND ($1 = '' OR c.full_name ILIKE '%' || $1 || '%' OR c.email ILIKE '%' || $1 || '%')
            AND ($2 = '' OR c.account_id = $2::uuid)
          ORDER BY c.created_at DESC
          LIMIT 200`,
        [q, accountId],
      );
      return result.rows.map(toContact);
    });

    return NextResponse.json(contacts);
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
      input = validateContactInput(await request.json());
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
          `INSERT INTO platform.crm_contacts (tenant_id, account_id, full_name, email, phone, title)
           VALUES ($1::uuid, $2, $3, $4, $5, $6)
           RETURNING contact_id, tenant_id, account_id, full_name, email, phone, title, status, created_at, updated_at`,
          [context.tenantId, input.accountId, input.fullName, input.email, input.phone, input.title],
        );
        return { contact: toContact(inserted.rows[0]) } as const;
      } catch (err: any) {
        if (err?.code === '23505') return { duplicate: true } as const;
        if (err?.code === '23503') return { badAccount: true } as const;
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to create contacts.' }, { status: 403 });
    }
    if ('duplicate' in result) {
      return NextResponse.json({ error: 'A contact with that email already exists in this workspace.' }, { status: 409 });
    }
    if ('badAccount' in result) {
      return NextResponse.json({ error: 'That account does not exist in this workspace.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, contact: result.contact }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
