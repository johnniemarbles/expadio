import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publishLearningAssignmentVersion } from '@expadio/postgres-runtime/learning-assignment';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ assignmentId: string; version: string }> }) {
  try {
    const context = await resolveBrandContext();
    const value = await params;
    const version = Number(value.version);
    if (!UUID.test(value.assignmentId) || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: 'LEARNING_ASSIGNMENT_VERSION_INVALID' }, { status: 400 });
    }
    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return publishLearningAssignmentVersion(client, {
        tenantId: context.tenantId, assignmentId: value.assignmentId, version,
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_PUBLISH_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : code.includes('NOT_FOUND') ? 404 : code.includes('REQUIRED') ? 409 : 400 });
  }
}
