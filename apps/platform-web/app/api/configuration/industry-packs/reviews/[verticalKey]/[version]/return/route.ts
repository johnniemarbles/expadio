import { NextResponse } from 'next/server';
import { transitionIndustryPackVersion } from '@expadio/industry-packs';
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

      const next = transitionIndustryPackVersion({
        current,
        to: 'DRAFT',
        actorSubjectId: context.subjectId,
        occurredAt: new Date().toISOString(),
      });

      try {
        const returned = await repository.transitionLifecycle({
          scope,
          identity: current.identity,
          expectedState: 'IN_REVIEW',
          next,
        });
        return { kind: 'RETURNED' as const, version: returned };
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
          message: 'You need a governing role to return Industry Packs to draft.',
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
          error: 'Only IN_REVIEW Industry Pack versions can be returned to draft.',
          reasonKey: 'INDUSTRY_PACK_STATE_TRANSITION_CONFLICT',
          state: outcome.state,
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
