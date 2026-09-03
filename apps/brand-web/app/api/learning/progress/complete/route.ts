import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { completeMyLearningLesson } from '@expadio/postgres-runtime/learning-enrollment';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as {
      enrollmentId?: unknown;
      lessonId?: unknown;
    } | null;
    if (
      typeof body?.enrollmentId !== 'string'
      || !UUID.test(body.enrollmentId)
      || typeof body.lessonId !== 'string'
      || !UUID.test(body.lessonId)
    ) {
      return NextResponse.json({ error: 'PROGRESS_TARGET_INVALID' }, { status: 400 });
    }

    const value = await withBrandTransaction(context, (client) =>
      completeMyLearningLesson(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
        enrollmentId: body.enrollmentId as string,
        lessonId: body.lessonId as string,
        correlationId: randomUUID(),
      }),
    );
    return NextResponse.json(value);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_PROGRESS_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ENROLLMENT_NOT_FOUND' ? 404 : code === 'LEARNING_LESSON_LOCKED' ? 403 : 400 });
  }
}
