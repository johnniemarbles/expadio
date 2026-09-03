import { NextResponse } from 'next/server';
import {
  createLearningQuestionBank,
  listLearningQuestionBanks,
} from '@expadio/postgres-runtime/learning-assessment';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const questionBanks = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return listLearningQuestionBanks(client, context.tenantId);
    });
    return NextResponse.json({ questionBanks }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_QUESTION_BANKS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'QUESTION_BANK_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const questionBank = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningQuestionBank(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        bankKey: body.bankKey,
        name: body.name,
      });
    });
    return NextResponse.json(questionBank, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_QUESTION_BANK_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
