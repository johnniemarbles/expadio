import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { createLearningAssignment } from '@expadio/postgres-runtime/learning-assignment';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '@/lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (typeof body?.courseVersionId !== 'string' || !UUID.test(body.courseVersionId)
      || typeof body.assignmentKey !== 'string' || typeof body.title !== 'string'
      || typeof body.instructions !== 'string' || typeof body.maxPoints !== 'number'
      || (body.allowAttachments !== undefined && typeof body.allowAttachments !== 'boolean')
      || (body.maxAttachments !== undefined && typeof body.maxAttachments !== 'number')
      || (body.dueAt !== undefined && body.dueAt !== null && typeof body.dueAt !== 'string')) {
      return NextResponse.json({ error: 'LEARNING_ASSIGNMENT_DRAFT_INVALID' }, { status: 400 });
    }
    const result = await withBrandTransaction(context, async (client: PoolClient) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningAssignment(client, {
        tenantId: context.tenantId, courseVersionId: body.courseVersionId as string,
        assignmentKey: body.assignmentKey as string, title: body.title as string,
        instructions: body.instructions as string, maxPoints: body.maxPoints as number,
        allowAttachments: body.allowAttachments as boolean | undefined,
        maxAttachments: body.maxAttachments as number | undefined,
        dueAt: body.dueAt as string | null | undefined, actorSubjectId: context.subjectId,
      });
    });
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : code.includes('EXISTS') ? 409 : 400 });
  }
}
