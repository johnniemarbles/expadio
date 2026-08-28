import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';
import { publishTenantBlueprint } from '../../../../lib/workflow-blueprints';

/**
 * Publish a tenant DRAFT/IN_REVIEW blueprint ACTIVE. Supersedes any version the
 * tenant currently has ACTIVE for the same work type, atomically, and records
 * publication provenance. A governed action requiring a tenant admin role; from
 * this point the blueprint resolver prefers this version for new case workflows.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const blueprintKey = typeof body?.blueprintKey === 'string' ? body.blueprintKey.trim() : '';
    const version = Number(body?.version);
    if (blueprintKey === '' || !Number.isInteger(version) || version <= 0) {
      return NextResponse.json({ error: 'A blueprintKey and a positive integer version are required.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        published: await publishTenantBlueprint(client, {
          tenantId: context.tenantId,
          blueprintKey,
          version,
          publishedBySubjectId: context.subjectId,
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to publish blueprints.' }, { status: 403 });
    }
    if (!result.published.ok) {
      const status = result.published.reason === 'NOT_FOUND' ? 404 : 409;
      const message = result.published.reason === 'NOT_FOUND'
        ? `No tenant blueprint "${blueprintKey}" version ${version} was found.`
        : 'Only a DRAFT or IN_REVIEW blueprint can be published.';
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json(
      { success: true, supersededVersion: result.published.supersededVersion },
      { status: 200 },
    );
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
