import { NextResponse } from 'next/server';
import {
  createLearningAssignmentRule,
  listLearningAssignmentRules,
} from '@expadio/postgres-runtime/learning-assignment-automation';
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
      return listLearningAssignmentRules(client, context.tenantId);
    });
    return NextResponse.json({ assignmentRules: result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENTS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'ASSIGNMENT_RULE_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const assignmentRule = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningAssignmentRule(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        ruleKey: body.ruleKey,
        draft: body.draft,
      });
    });
    return NextResponse.json(assignmentRule, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
