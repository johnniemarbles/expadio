import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { submitMyAssessmentAttempt } from '@expadio/postgres-runtime/learning-assessment';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { learningApiError, requireLearningUuid } from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const attemptId = requireLearningUuid(
      decodeURIComponent((await params).attemptId),
      'attemptId',
    );
    const responses = await request.json().catch(() => ({}));

    const result = await withTenantTransaction(context, (client) =>
      submitMyAssessmentAttempt(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        attemptId,
        responses,
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
