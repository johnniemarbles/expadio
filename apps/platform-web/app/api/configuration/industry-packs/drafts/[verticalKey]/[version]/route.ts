import { NextResponse } from 'next/server';
import { validateIndustryPackDefinition } from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../../../lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ verticalKey: string; version: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const resolvedParams = await params;
    const verticalKey = decodeURIComponent(resolvedParams.verticalKey).trim().toLowerCase();
    const version = Number(resolvedParams.version);
    if (verticalKey === '' || !Number.isInteger(version) || version <= 0) {
      return NextResponse.json(
        { error: 'A valid verticalKey and positive integer version are required.' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'A JSON request body is required.' }, { status: 400 });
    }

    const expectedRevision = body.expectedRevision;
    if (!Number.isInteger(expectedRevision) || Number(expectedRevision) <= 0) {
      return NextResponse.json(
        { error: 'expectedRevision must be a positive integer.' },
        { status: 400 },
      );
    }

    const validation = validateIndustryPackDefinition(body.definition, verticalKey);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Industry Pack definition is invalid.',
          issues: validation.issues,
        },
        { status: 400 },
      );
    }

    try {
      const result = await withTenantTransaction(context, async (client) => {
        if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
          return { forbidden: true } as const;
        }
        const repository = new PostgresIndustryPackVersionRepository(client);
        const draft = await repository.updateDraft({
          scope: { type: 'TENANT', tenantId: context.tenantId },
          identity: { verticalKey, version },
          expectedRevision: Number(expectedRevision),
          definition: validation.definition,
          updatedBySubjectId: context.subjectId,
        });
        return { draft } as const;
      });

      if ('forbidden' in result) {
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'FORBIDDEN',
            message: 'You need a governing role to edit Industry Pack drafts.',
          },
          { status: 403 },
        );
      }
      return NextResponse.json({ draft: result.draft });
    } catch (error) {
      if (error instanceof Error && error.message === 'INDUSTRY_PACK_DRAFT_UPDATE_CONFLICT') {
        return NextResponse.json(
          {
            error: 'The Industry Pack draft changed or is no longer editable. Refresh and try again.',
            reasonKey: 'INDUSTRY_PACK_DRAFT_UPDATE_CONFLICT',
          },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
