import { NextResponse } from 'next/server';
import { recordMyLearningLessonResume } from '@expadio/postgres-runtime/learning-enrollment';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (
      typeof body?.enrollmentId !== 'string' || !UUID.test(body.enrollmentId)
      || typeof body.lessonId !== 'string' || !UUID.test(body.lessonId)
      || typeof body.blockId !== 'string'
      || !Number.isInteger(body.position) || Number(body.position) < 1
    ) {
      return NextResponse.json({ error: 'LEARNING_RESUME_TARGET_INVALID' }, { status: 400 });
    }
    const value = await withBrandTransaction(context, (client) =>
      recordMyLearningLessonResume(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
        enrollmentId: body.enrollmentId as string,
        lessonId: body.lessonId as string,
        blockId: body.blockId as string,
        position: Number(body.position),
      }),
    );
    return NextResponse.json(value, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_RESUME_FAILED';
    const status = code === 'LEARNING_LESSON_LOCKED' ? 403
      : code === 'LEARNING_ENROLLMENT_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
