import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { startMyAssessmentAttempt } from '@expadio/postgres-runtime/learning-assessment';
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
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const assessmentId = requireLearningUuid(decodeURIComponent((await params).id), 'assessmentId');
    const raw = await request.json().catch(() => ({}));
    const body = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const enrollmentId = typeof body.enrollmentId === 'string'
      ? requireLearningUuid(body.enrollmentId, 'enrollmentId')
      : requireLearningUuid('', 'enrollmentId');
    const attemptKey = typeof body.attemptKey === 'string' && body.attemptKey.trim() !== ''
      ? body.attemptKey.trim()
      : request.headers.get('idempotency-key')?.trim() ?? '';

    const attempt = await withTenantTransaction(context, (client) =>
      startMyAssessmentAttempt(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        assessmentId,
        enrollmentId,
        attemptKey,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      }),
    );

    return NextResponse.json(attempt, {
      status: attempt.idempotent ? 200 : 201,
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
