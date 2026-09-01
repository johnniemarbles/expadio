import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createLearningProgramEnrollment,
  listLearningProgramEnrollments,
} from '@expadio/postgres-runtime/learning-program-certification';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import {
  learningApiError,
  requireLearningUuid,
} from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const learnerRaw = new URL(request.url).searchParams.get('learnerId');
    const learnerId = learnerRaw === null ? undefined : requireLearningUuid(learnerRaw, 'learnerId');
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return { forbidden: true } as const;
      return {
        programEnrollments: await listLearningProgramEnrollments(client, {
          tenantId: context.tenantId,
          ...(learnerId === undefined ? {} : { learnerId }),
        }),
      } as const;
    });
    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning program enrollment administration requires a tenant administrator role.' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const raw = await request.json().catch(() => ({}));
    const body = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const learnerId = requireLearningUuid(
      typeof body.learnerId === 'string' ? body.learnerId : '',
      'learnerId',
    );
    const programId = requireLearningUuid(
      typeof body.programId === 'string' ? body.programId : '',
      'programId',
    );
    const assignmentKey = body.assignmentKey ?? request.headers.get('idempotency-key');
    const sourceType = body.sourceType ?? 'MANUAL';
    if (
      sourceType !== 'MANUAL'
      && sourceType !== 'RULE'
      && sourceType !== 'IMPORT'
      && sourceType !== 'SELF'
    ) {
      throw new Error('LEARNING_PROGRAM_SOURCE_TYPE_INVALID');
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return { forbidden: true } as const;
      return {
        assigned: await createLearningProgramEnrollment(client, {
          tenantId: context.tenantId,
          actorSubjectId: context.subjectId,
          correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
          learnerId,
          programId,
          assignmentKey,
          sourceType,
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning program enrollment administration requires a tenant administrator role.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result.assigned, {
      status: result.assigned.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
