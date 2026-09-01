import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publishLearningCourseVersion } from '@expadio/postgres-runtime/learning';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    const { id } = await params;
    const body = await request.json() as { version?: unknown };
    if (!Number.isInteger(body.version) || Number(body.version) < 1) return NextResponse.json({ error: 'VERSION_INVALID' }, { status: 400 });
    const value = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return publishLearningCourseVersion(client, {
        tenantId: context.tenantId, courseId: id, version: Number(body.version),
        actorSubjectId: context.subjectId, correlationId: randomUUID(),
      });
    });
    return NextResponse.json(value);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
