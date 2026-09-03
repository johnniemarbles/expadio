import { NextResponse } from 'next/server';
import { listLearningAssignmentSubmissions } from '@expadio/postgres-runtime/learning-assignment';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const submissions = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return listLearningAssignmentSubmissions(client, context.tenantId);
    });
    return NextResponse.json({ submissions }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_SUBMISSIONS_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
