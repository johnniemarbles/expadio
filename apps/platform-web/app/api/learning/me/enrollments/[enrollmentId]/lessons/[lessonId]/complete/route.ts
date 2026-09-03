import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { completeMyLearningLesson } from '@expadio/postgres-runtime/learning-enrollment';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import {
  learningApiError,
  requireLearningUuid,
} from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enrollmentId: string; lessonId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const raw = await params;
    const enrollmentId = requireLearningUuid(decodeURIComponent(raw.enrollmentId), 'enrollmentId');
    const lessonId = requireLearningUuid(decodeURIComponent(raw.lessonId), 'lessonId');

    const result = await withTenantTransaction(context, (client) =>
      completeMyLearningLesson(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        enrollmentId,
        lessonId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      }),
    );

    return NextResponse.json(result, {
      status: result.idempotent ? 200 : 201,
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
