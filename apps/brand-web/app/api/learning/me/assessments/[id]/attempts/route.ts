import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { startMyAssessmentAttempt } from '@expadio/postgres-runtime/learning-assessment';
import { resolveBrandContext, withBrandTransaction } from '../../../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const assessmentId = decodeURIComponent((await params).id);
    const raw = await request.json().catch(() => null);
    const body = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    if (!UUID.test(assessmentId) || typeof body.enrollmentId !== 'string' || !UUID.test(body.enrollmentId)) {
      return NextResponse.json({ error: 'ASSESSMENT_TARGET_INVALID' }, { status: 400 });
    }

    const attemptKey =
      typeof body.attemptKey === 'string' && body.attemptKey.trim()
        ? body.attemptKey.trim()
        : randomUUID();

    const attempt = await withBrandTransaction(context, (client) =>
      startMyAssessmentAttempt(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
        assessmentId,
        enrollmentId: body.enrollmentId as string,
        attemptKey,
        correlationId: randomUUID(),
      }),
    );

    return NextResponse.json(attempt, { status: attempt.idempotent ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSESSMENT_START_FAILED';
    const status =
      code === 'LEARNING_ASSESSMENT_NOT_FOUND' || code === 'LEARNING_ASSESSMENT_ENROLLMENT_MISMATCH' ? 404
        : code === 'LEARNING_ASSESSMENT_ATTEMPT_LIMIT_REACHED' ? 409
          : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
