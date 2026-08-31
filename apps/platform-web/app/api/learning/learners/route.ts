import { NextResponse } from 'next/server';
import {
  createLearningLearner,
  listLearningLearners,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { learningApiError } from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return { learners: await listLearningLearners(client, context.tenantId) } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning learner administration requires a tenant administrator role.' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) {
      return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json().catch(() => ({}));
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        learner: await createLearningLearner(client, {
          tenantId: context.tenantId,
          actorSubjectId: context.subjectId,
          learner: body,
          correlationId: request.headers.get('x-correlation-id')?.trim() || undefined,
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning learner administration requires a tenant administrator role.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result.learner, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) {
      return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
