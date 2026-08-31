import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileMyLearningProgramEnrollment } from '@expadio/postgres-runtime/learning-program-certification';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import {
  learningApiError,
  requireLearningUuid,
} from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const programEnrollmentId = requireLearningUuid(
      decodeURIComponent((await params).id),
      'programEnrollmentId',
    );
    const result = await withTenantTransaction(context, (client) =>
      reconcileMyLearningProgramEnrollment(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        programEnrollmentId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      }),
    );
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
