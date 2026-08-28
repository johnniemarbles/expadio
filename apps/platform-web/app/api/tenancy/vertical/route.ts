import { NextResponse } from 'next/server';
import { findIndustryPack, listIndustryPackChoices } from '@expadio/industry-packs';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';

/**
 * The workspace's active Industry Pack (vertical). Reading is a membership read;
 * changing it requires a governing role. Setting a vertical only reskins display
 * text — it never touches canonical keys, authorization, or persisted data.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const verticalKey = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT vertical_key FROM platform.tenants WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      );
      return result.rows[0]?.vertical_key ?? null;
    });
    return NextResponse.json({ verticalKey, choices: listIndustryPackChoices() });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const raw = typeof body?.verticalKey === 'string' ? body.verticalKey.trim() : '';
    // Empty string clears the binding (back to the neutral engine).
    const verticalKey = raw === '' ? null : raw.toLowerCase();
    if (verticalKey !== null && findIndustryPack(verticalKey) === null) {
      return NextResponse.json({ error: 'Unknown industry pack.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const updated = await client.query(
        `UPDATE platform.tenants SET vertical_key = $2, updated_at = now()
          WHERE tenant_id = $1::uuid
          RETURNING vertical_key`,
        [context.tenantId, verticalKey],
      );
      if (updated.rows.length === 0) return { notFound: true } as const;
      return { verticalKey: updated.rows[0].vertical_key ?? null } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to change the industry pack.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, verticalKey: result.verticalKey });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
