import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { clonePublishedLearningCourseVersion } from '@expadio/postgres-runtime/learning';
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const courseId = requireLearningUuid(
      decodeURIComponent((await params).id),
      'courseId',
    );

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        version: await clonePublishedLearningCourseVersion(client, {
          tenantId: context.tenantId,
          courseId,
          actorSubjectId: context.subjectId,
          correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'Learning authoring requires a tenant administrator role.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(result.version, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) {
      return NextResponse.json(mapped.body, {
        status: mapped.status,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
