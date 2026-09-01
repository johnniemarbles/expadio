import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createLearningEnrollment } from '@expadio/postgres-runtime/learning-enrollment';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'ENROLLMENT_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    if (typeof body.learnerId !== 'string' || !UUID.test(body.learnerId)) {
      return NextResponse.json({ error: 'LEARNER_ID_INVALID' }, { status: 400 });
    }
    if (typeof body.courseId !== 'string' || !UUID.test(body.courseId)) {
      return NextResponse.json({ error: 'COURSE_ID_INVALID' }, { status: 400 });
    }
    if (typeof body.idempotencyKey !== 'string' || !UUID.test(body.idempotencyKey)) {
      return NextResponse.json({ error: 'IDEMPOTENCY_KEY_INVALID' }, { status: 400 });
    }

    const value = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningEnrollment(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
        enrollment: {
          assignmentKey: `brand-manual:${body.idempotencyKey}`,
          learnerId: body.learnerId,
          courseId: body.courseId,
          sourceType: 'MANUAL',
          sourceRef: 'brand-learning-ui',
          dueAt: typeof body.dueAt === 'string' && body.dueAt.trim() ? body.dueAt : null,
        },
      });
    });

    return NextResponse.json(value, { status: value.idempotent ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'ENROLLMENT_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
