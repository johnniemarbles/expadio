import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createLearningLearner } from '@expadio/postgres-runtime/learning-enrollment';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';

const AUDIENCES = new Set(['INTERNAL', 'PARTNER', 'CUSTOMER', 'EXTERNAL']);

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'LEARNER_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const fullName = typeof body.fullName === 'string' ? body.fullName : '';
    const email = typeof body.email === 'string' && body.email.trim() ? body.email : null;
    const subjectId = typeof body.subjectId === 'string' && body.subjectId.trim() ? body.subjectId : null;
    const audienceType =
      typeof body.audienceType === 'string' && AUDIENCES.has(body.audienceType)
        ? body.audienceType
        : 'INTERNAL';

    const learner = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningLearner(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
        learner: {
          subjectId,
          contactId: null,
          externalRef: subjectId === null ? `manual:${randomUUID()}` : null,
          fullName,
          email,
          audienceType,
          metadata: { source: 'brand-learning-ui' },
        },
      });
    });

    return NextResponse.json(learner, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNER_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
