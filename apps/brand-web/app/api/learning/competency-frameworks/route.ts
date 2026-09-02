import { NextResponse } from 'next/server';
import {
  createLearningCompetencyFramework,
  listLearningCompetencyFrameworks,
} from '@expadio/postgres-runtime/learning-competency';
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
      return listLearningCompetencyFrameworks(client, context.tenantId);
    });
    return NextResponse.json({ competencyFrameworks: result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_COMPETENCIES_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'COMPETENCY_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const framework = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningCompetencyFramework(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        frameworkKey: body.frameworkKey,
        draft: body.draft,
      });
    });
    return NextResponse.json(framework, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_COMPETENCY_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
