import { NextResponse } from 'next/server';
import { previewLearningAssignmentRule } from '@expadio/postgres-runtime/learning-assignment-automation';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'ASSIGNMENT_RULE_PREVIEW_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const preview = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return previewLearningAssignmentRule(client, {
        tenantId: context.tenantId,
        draft: body.draft,
        sampleLimit: 25,
      });
    });
    return NextResponse.json({ preview }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_RULE_PREVIEW_FAILED';
    return NextResponse.json({ error: code }, {
      status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400,
    });
  }
}
