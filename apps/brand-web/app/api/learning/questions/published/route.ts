import { NextResponse } from 'next/server';
import { listLearningPublishedQuestions } from '@expadio/postgres-runtime/learning-assessment';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const questions = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return listLearningPublishedQuestions(client, context.tenantId);
    });
    return NextResponse.json({ questions }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_QUESTIONS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
