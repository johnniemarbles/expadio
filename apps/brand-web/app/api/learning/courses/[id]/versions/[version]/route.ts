import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { replaceLearningCourseDraft } from '@expadio/postgres-runtime/learning';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { id, version: rawVersion } = await params;
    const version = Number(rawVersion);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: 'LEARNING_DRAFT_IDENTIFIER_INVALID' }, { status: 400 });
    }
    const draft = await request.json().catch(() => ({}));
    const result = await withBrandTransaction(context, async (client: any) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return replaceLearningCourseDraft(client, {
        tenantId: context.tenantId,
        courseId: id,
        version,
        actorSubjectId: context.subjectId,
        draft,
      });
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const status = code === 'LEARNING_ADMIN_REQUIRED' ? 403
      : /IMMUTABLE|CONFLICT|NOT_FOUND/.test(code) ? 409 : 400;
    return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
