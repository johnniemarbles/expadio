import { NextResponse } from 'next/server';
import {
  createLearningCompetencyFramework,
  listLearningCompetencyFrameworks,
} from '@expadio/postgres-runtime/learning-competency';
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
      return {
        competencyFrameworks: await listLearningCompetencyFrameworks(
          client,
          context.tenantId,
        ),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'Learning competency administration requires a tenant administrator role.',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json(result, {
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

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const raw = await request.json().catch(() => ({}));
    const body =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        framework: await createLearningCompetencyFramework(client, {
          tenantId: context.tenantId,
          actorSubjectId: context.subjectId,
          frameworkKey: body.frameworkKey,
          draft: body.draft,
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'Learning competency administration requires a tenant administrator role.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json(result.framework, {
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
