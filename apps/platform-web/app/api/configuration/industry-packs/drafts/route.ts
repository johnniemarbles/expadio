import { NextResponse } from 'next/server';
import { validateIndustryPackDefinition } from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'A JSON request body is required.' }, { status: 400 });
    }

    const verticalKey = typeof body.verticalKey === 'string'
      ? body.verticalKey.trim().toLowerCase()
      : '';
    if (verticalKey === '') {
      return NextResponse.json({ error: 'verticalKey is required.' }, { status: 400 });
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

    const parentVersion = body.parentVersion;
    if (
      parentVersion !== undefined
      && (!Number.isInteger(parentVersion) || Number(parentVersion) <= 0)
    ) {
      return NextResponse.json(
        { error: 'parentVersion must be a positive integer.' },
        { status: 400 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const repository = new PostgresIndustryPackVersionRepository(client);
      const draft = await repository.createDraft({
        scope: { type: 'TENANT', tenantId: context.tenantId },
        verticalKey,
        definition: validation.definition,
        createdBySubjectId: context.subjectId,
        ...(parentVersion === undefined
          ? {}
          : { parent: { verticalKey, version: Number(parentVersion) } }),
      });
      return { draft } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'You need a governing role to create Industry Pack drafts.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ draft: result.draft }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
