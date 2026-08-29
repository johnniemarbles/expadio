import { NextResponse } from 'next/server';
import {
  transitionIndustryPackVersion,
  validateIndustryPackDefinition,
} from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../../../../lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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

    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { kind: 'FORBIDDEN' as const };
      }

      const repository = new PostgresIndustryPackVersionRepository(client);
      const scope = { type: 'TENANT' as const, tenantId: context.tenantId };
      const current = await repository.findByIdentity({
        scope,
        identity: { verticalKey, version },
      });

      if (current === null) return { kind: 'NOT_FOUND' as const };
      if (current.state !== 'IN_REVIEW') {
        return { kind: 'STATE_CONFLICT' as const, state: current.state };
      }
      if (current.submittedBySubjectId === undefined) {
        return { kind: 'REVIEW_PROVENANCE_MISSING' as const };
      }
      if (current.submittedBySubjectId === context.subjectId) {
        return { kind: 'SOD_DENIED' as const };
      }

      const definitionValidation = validateIndustryPackDefinition(current.definition, verticalKey);
      if (!definitionValidation.valid) {
        return {
          kind: 'DEFINITION_INVALID' as const,
          issues: definitionValidation.issues,
        };
      }

      const occurredAt = new Date().toISOString();
      const versions = await repository.listVersions({ scope, verticalKey });
      const published = versions.find(
        (candidate) =>
          candidate.state === 'PUBLISHED'
          && candidate.identity.version !== current.identity.version,
      );

      try {
        if (published !== undefined) {
          const superseded = transitionIndustryPackVersion({
            current: published,
            to: 'SUPERSEDED',
            actorSubjectId: context.subjectId,
            occurredAt,
          });
          await repository.transitionLifecycle({
            scope,
            identity: published.identity,
            expectedState: 'PUBLISHED',
            next: superseded,
          });
        }

        const next = transitionIndustryPackVersion({
          current,
          to: 'PUBLISHED',
          actorSubjectId: context.subjectId,
          occurredAt,
        });
        const publishedVersion = await repository.transitionLifecycle({
          scope,
          identity: current.identity,
          expectedState: 'IN_REVIEW',
          next,
        });
        return { kind: 'PUBLISHED' as const, version: publishedVersion };
      } catch (error) {
        if (
          error instanceof Error
          && error.message === 'INDUSTRY_PACK_LIFECYCLE_TRANSITION_CONFLICT'
        ) {
          return { kind: 'STATE_CONFLICT' as const, state: 'UNKNOWN' };
        }
        throw error;
      }
    });

    if (outcome.kind === 'FORBIDDEN') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'You need a governing role to publish Industry Packs.',
        },
        { status: 403 },
      );
    }
    if (outcome.kind === 'SOD_DENIED') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'SEPARATION_OF_DUTIES',
          message: 'The subject who submitted an Industry Pack cannot publish the same version.',
        },
        { status: 403 },
      );
    }
    if (outcome.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Industry Pack review version was not found.' }, { status: 404 });
    }
    if (outcome.kind === 'STATE_CONFLICT') {
      return NextResponse.json(
        {
          error: 'Only IN_REVIEW Industry Pack versions can be published.',
          reasonKey: 'INDUSTRY_PACK_STATE_TRANSITION_CONFLICT',
          state: outcome.state,
        },
        { status: 409 },
      );
    }
    if (outcome.kind === 'REVIEW_PROVENANCE_MISSING') {
      return NextResponse.json(
        {
          error: 'Review submission provenance is missing; this version cannot be published.',
          reasonKey: 'INDUSTRY_PACK_REVIEW_PROVENANCE_MISSING',
        },
        { status: 409 },
      );
    }
    if (outcome.kind === 'DEFINITION_INVALID') {
      return NextResponse.json(
        {
          error: 'The persisted Industry Pack definition is invalid and cannot be published.',
          reasonKey: 'INDUSTRY_PACK_DEFINITION_INVALID',
          issues: outcome.issues,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ version: outcome.version });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
