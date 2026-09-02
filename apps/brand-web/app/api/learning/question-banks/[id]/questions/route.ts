import { NextResponse } from 'next/server';
import { createLearningQuestion } from '@expadio/postgres-runtime/learning-assessment';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const questionBankId = decodeURIComponent((await params).id);
    if (!UUID.test(questionBankId)) {
      return NextResponse.json({ error: 'QUESTION_BANK_ID_INVALID' }, { status: 400 });
    }

    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'QUESTION_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;

    const question = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningQuestion(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        questionBankId,
        questionKey: body.questionKey,
        draft: body.draft,
      });
    });

    return NextResponse.json(question, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_QUESTION_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
