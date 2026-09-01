import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createLearningAiRequest,
  type LearningAiRequestType,
} from '@expadio/postgres-runtime/learning-ai';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { learningApiError } from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES = new Set<LearningAiRequestType>([
  'TUTOR',
  'AUTHOR_DRAFT',
  'ASSESSMENT_FEEDBACK',
  'COACH',
]);

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const raw = await request.json().catch(() => ({}));
    const body =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const requestType =
      typeof body.requestType === 'string'
      && TYPES.has(body.requestType as LearningAiRequestType)
        ? (body.requestType as LearningAiRequestType)
        : null;
    if (requestType === null) {
      return NextResponse.json(
        {
          reasonKey: 'LEARNING_AI_REQUEST_TYPE_INVALID',
          message: 'A supported Learning AI requestType is required.',
        },
        { status: 400 },
      );
    }
    if (typeof body.prompt !== 'string') {
      return NextResponse.json(
        {
          reasonKey: 'LEARNING_AI_PROMPT_REQUIRED',
          message: 'prompt is required.',
        },
        { status: 400 },
      );
    }
    if (typeof body.idempotencyKey !== 'string') {
      return NextResponse.json(
        {
          reasonKey: 'LEARNING_AI_IDEMPOTENCY_KEY_INVALID',
          message: 'idempotencyKey is required.',
        },
        { status: 400 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (
        (requestType === 'AUTHOR_DRAFT'
          || requestType === 'ASSESSMENT_FEEDBACK')
        && !(await hasLearningAuthoringRole(client, context.subjectId))
      ) {
        return { forbidden: true } as const;
      }

      return {
        value: await createLearningAiRequest(client, {
          tenantId: context.tenantId,
          actorSubjectId: context.subjectId,
          actorIssuer: context.issuer ?? null,
          correlationId:
            request.headers.get('x-correlation-id')?.trim() || randomUUID(),
          requestType,
          prompt: body.prompt as string,
          idempotencyKey: body.idempotencyKey as string,
          ...(typeof body.courseId === 'string'
            ? { courseId: body.courseId }
            : {}),
          metadata:
            body.metadata !== null
            && typeof body.metadata === 'object'
            && !Array.isArray(body.metadata)
              ? (body.metadata as Readonly<Record<string, unknown>>)
              : {},
        }),
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'This Learning AI request requires an authoring role.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(result.value.request, {
      status: result.value.created ? 202 : 200,
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
    return NextResponse.json(body, { status });
  }
}
