import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { submitMyAssessmentAttempt } from '@expadio/postgres-runtime/learning-assessment';
import { resolveBrandContext, withBrandTransaction } from '../../../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const attemptId = decodeURIComponent((await params).attemptId);
    if (!UUID.test(attemptId)) {
      return NextResponse.json({ error: 'ASSESSMENT_ATTEMPT_ID_INVALID' }, { status: 400 });
    }
    const responses = await request.json().catch(() => null);
    const result = await withBrandTransaction(context, (client) =>
      submitMyAssessmentAttempt(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
        attemptId,
        responses,
        correlationId: randomUUID(),
      }),
    );
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSESSMENT_SUBMIT_FAILED';
    const status =
      code === 'LEARNING_ASSESSMENT_ATTEMPT_NOT_FOUND' ? 404
        : code === 'LEARNING_ASSESSMENT_ATTEMPT_EXPIRED' ? 409
          : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
