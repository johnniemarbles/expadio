import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publishLearningCourseVersion } from '@expadio/postgres-runtime/learning';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import {
  learningApiError,
  requireLearningUuid,
  requireLearningVersion,
} from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const raw = await params;
    const courseId = requireLearningUuid(decodeURIComponent(raw.id), 'courseId');
    const version = requireLearningVersion(decodeURIComponent(raw.version));

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        published: await publishLearningCourseVersion(client, {
          tenantId: context.tenantId,
          courseId,
          version,
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
          message: 'Learning publication requires a tenant administrator role.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(result.published, {
      status: result.published.idempotent ? 200 : 201,
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
