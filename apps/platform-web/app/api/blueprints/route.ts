import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../lib/request-context';
import { hasCrmWriteRole } from '../../../lib/crm-authz';
import { listBlueprintsForAuthoring, createTenantDraftFromPlatform } from '../../../lib/workflow-blueprints';

/**
 * Tenant workflow-blueprint authoring. GET lists every blueprint visible to the
 * tenant (the platform catalogue plus this tenant's own versions). POST clones
 * the ACTIVE platform blueprint for a key into a new tenant DRAFT — a governed
 * action requiring a tenant admin role. Tenant-scoped by RLS.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const blueprints = await withTenantClient(context, (client) =>
      listBlueprintsForAuthoring(client, { tenantId: context.tenantId }),
    );
    return NextResponse.json({ blueprints });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const blueprintKey = typeof body?.blueprintKey === 'string' ? body.blueprintKey.trim() : '';
    if (blueprintKey === '') {
      return NextResponse.json({ error: 'A blueprintKey is required.' }, { status: 400 });
    }
    const label = typeof body?.label === 'string' ? body.label : undefined;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return { draft: await createTenantDraftFromPlatform(client, { tenantId: context.tenantId, blueprintKey, label }) } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to author blueprints.' }, { status: 403 });
    }
    if (!result.draft.ok) {
      return NextResponse.json({ error: `No platform blueprint found for "${blueprintKey}".` }, { status: 404 });
    }
    return NextResponse.json(
      { success: true, blueprintKey: result.draft.blueprint.blueprintKey, version: result.draft.blueprint.version },
      { status: 201 },
    );
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
