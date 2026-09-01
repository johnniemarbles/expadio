import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createLearningEnrollment,
  listLearningEnrollments,
} from '@expadio/postgres-runtime/learning-enrollment';
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
    const learnerIdRaw = new URL(request.url).searchParams.get('learnerId');
    const learnerId = learnerIdRaw === null ? undefined : requireLearningUuid(learnerIdRaw, 'learnerId');

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        enrollments: await listLearningEnrollments(client, {
          tenantId: context.tenantId,
          ...(learnerId === undefined ? {} : { learnerId }),
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning enrollment administration requires a tenant administrator role.' },
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
    const rawBody = await request.json().catch(() => ({}));
    const body = rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody as Record<string, unknown>
      : {};
    const assignmentKey = body.assignmentKey ?? request.headers.get('idempotency-key');

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        result: await createLearningEnrollment(client, {
          tenantId: context.tenantId,
          actorSubjectId: context.subjectId,
          correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
          enrollment: { ...body, assignmentKey },
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning enrollment administration requires a tenant administrator role.' },
        { status: 403 },
      );
    }

    return NextResponse.json(result.result, {
      status: result.result.idempotent ? 200 : 201,
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
