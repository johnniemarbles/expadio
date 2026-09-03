import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createLearningProgramEnrollment } from '@expadio/postgres-runtime/learning-program-certification';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'PROGRAM_ENROLLMENT_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    if (typeof body.learnerId !== 'string' || !UUID.test(body.learnerId)) {
      return NextResponse.json({ error: 'LEARNER_ID_INVALID' }, { status: 400 });
    }
    if (typeof body.programId !== 'string' || !UUID.test(body.programId)) {
      return NextResponse.json({ error: 'PROGRAM_ID_INVALID' }, { status: 400 });
    }
    const value = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningProgramEnrollment(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
        learnerId: body.learnerId as string,
        programId: body.programId as string,
        assignmentKey:
          typeof body.assignmentKey === 'string' && body.assignmentKey.trim()
            ? body.assignmentKey
            : `brand-program:${randomUUID()}`,
        sourceType: 'MANUAL',
      });
    });
    return NextResponse.json(value, { status: value.idempotent ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_PROGRAM_ENROLLMENT_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
