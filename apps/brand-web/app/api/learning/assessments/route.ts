import { NextResponse } from 'next/server';
import {
  createLearningAssessment,
  listLearningAssessments,
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
    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return listLearningAssessments(client, context.tenantId);
    });
    return NextResponse.json({ assessments: result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSESSMENTS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'ASSESSMENT_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const assessment = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningAssessment(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        assessmentKey: body.assessmentKey,
        draft: body.draft,
      });
    });
    return NextResponse.json(assessment, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSESSMENT_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
