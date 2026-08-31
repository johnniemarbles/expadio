import { NextResponse } from 'next/server';
import {
  loadLearningCourseVersion,
  replaceLearningCourseDraft,
} from '@expadio/postgres-runtime/learning';
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

async function resolvedParams(params: Promise<{ id: string; version: string }>) {
  const raw = await params;
  return {
    courseId: requireLearningUuid(decodeURIComponent(raw.id), 'courseId'),
    version: requireLearningVersion(decodeURIComponent(raw.version)),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const target = await resolvedParams(params);

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        version: await loadLearningCourseVersion(client, {
          tenantId: context.tenantId,
          courseId: target.courseId,
          version: target.version,
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const target = await resolvedParams(params);
    const body = await request.json().catch(() => ({}));

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        version: await replaceLearningCourseDraft(client, {
          tenantId: context.tenantId,
          courseId: target.courseId,
          version: target.version,
          actorSubjectId: context.subjectId,
          draft: body,
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
