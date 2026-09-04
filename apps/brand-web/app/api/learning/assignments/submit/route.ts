import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { submitMyLearningAssignment } from '@expadio/postgres-runtime/learning-assignment';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (typeof body?.enrollmentId !== 'string' || !UUID.test(body.enrollmentId)
      || typeof body.lessonId !== 'string' || !UUID.test(body.lessonId)
      || typeof body.assignmentKey !== 'string' || !KEY.test(body.assignmentKey)
      || typeof body.submissionKey !== 'string' || body.submissionKey.trim() === ''
      || typeof body.responseText !== 'string'
      || (body.attachmentAssetIds !== undefined && (!Array.isArray(body.attachmentAssetIds) || !body.attachmentAssetIds.every((value) => typeof value === 'string' && UUID.test(value))))) {
      return NextResponse.json({ error: 'LEARNING_ASSIGNMENT_SUBMISSION_INVALID' }, { status: 400 });
    }
    const result = await withBrandTransaction(context, (client) => submitMyLearningAssignment(client, {
      tenantId: context.tenantId,
      subjectId: context.subjectId,
      subjectIssuer: context.issuer,
      enrollmentId: body.enrollmentId as string,
      lessonId: body.lessonId as string,
      assignmentKey: body.assignmentKey as string,
      submissionKey: body.submissionKey as string,
      responseText: body.responseText as string,
      attachmentAssetIds: body.attachmentAssetIds as string[] | undefined,
      correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
    }));
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSIGNMENT_SUBMISSION_FAILED';
    const status = code.includes('NOT_AVAILABLE') ? 404 : code.includes('DUE_DATE') ? 409 : 400;
    return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
