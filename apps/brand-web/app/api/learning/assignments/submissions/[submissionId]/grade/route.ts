import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { gradeLearningAssignmentSubmission } from '@expadio/postgres-runtime/learning-assignment';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const context = await resolveBrandContext();
    const submissionId = decodeURIComponent((await params).submissionId);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!UUID.test(submissionId)
      || (body?.outcome !== 'RETURNED' && body?.outcome !== 'GRADED')
      || typeof body.feedback !== 'string'
      || (body.scorePoints !== undefined && typeof body.scorePoints !== 'number')) {
      return NextResponse.json({ error: 'LEARNING_ASSIGNMENT_GRADE_INVALID' }, { status: 400 });
    }
    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return gradeLearningAssignmentSubmission(client, {
        tenantId: context.tenantId,
        submissionId,
        actorSubjectId: context.subjectId,
        outcome: body.outcome as 'RETURNED' | 'GRADED',
        scorePoints: body.scorePoints as number | undefined,
        feedback: body.feedback as string,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_GRADE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : code.includes('NOT_FOUND') ? 404 : code.includes('NOT_GRADABLE') ? 409 : 400 });
  }
}
