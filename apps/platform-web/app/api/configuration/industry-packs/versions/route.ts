import { NextResponse } from 'next/server';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function summarize(version: any) {
  return {
    verticalKey: version.identity.verticalKey,
    version: version.identity.version,
    scope: version.scope.type,
    source: version.source,
    state: version.state,
    revision: version.revision,
    label: version.definition.label,
    ...(version.parent === undefined ? {} : { parent: version.parent }),
    createdBySubjectId: version.createdBySubjectId,
    createdAt: version.createdAt,
    updatedBySubjectId: version.updatedBySubjectId,
    updatedAt: version.updatedAt,
    ...(version.submittedBySubjectId === undefined
      ? {}
      : {
          submittedBySubjectId: version.submittedBySubjectId,
          submittedAt: version.submittedAt,
        }),
    ...(version.publishedBySubjectId === undefined
      ? {}
      : {
          publishedBySubjectId: version.publishedBySubjectId,
          publishedAt: version.publishedAt,
        }),
  };
}

/**
 * Read-only Industry Pack authoring history for one vertical.
 *
 * Tenant RLS exposes this tenant's authored versions plus platform versions that
 * are already PUBLISHED/SUPERSEDED/ARCHIVED. Platform drafts/review artifacts
 * remain hidden from tenant callers.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const verticalKey = new URL(request.url).searchParams.get('verticalKey')?.trim().toLowerCase() ?? '';
    if (verticalKey === '') {
      return NextResponse.json({ error: 'verticalKey is required.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      const repository = new PostgresIndustryPackVersionRepository(client);
      const [tenantVersions, platformVersions] = await Promise.all([
        repository.listVersions({
          scope: { type: 'TENANT', tenantId: context.tenantId },
          verticalKey,
        }),
        repository.listVersions({
          scope: { type: 'PLATFORM' },
          verticalKey,
        }),
      ]);

      return {
        verticalKey,
        tenantVersions: tenantVersions.map(summarize),
        platformVersions: platformVersions.map(summarize),
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
