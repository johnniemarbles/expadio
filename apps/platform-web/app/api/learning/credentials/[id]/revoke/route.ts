import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { revokeLearningCredential } from '@expadio/postgres-runtime/learning-program-certification';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
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
    const credentialId = requireLearningUuid(decodeURIComponent((await params).id), 'credentialId');
    const raw = await request.json().catch(() => ({}));
    const body = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const reason = typeof body.reason === 'string' ? body.reason : '';

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return { forbidden: true } as const;
      return {
        revoked: await revokeLearningCredential(client, {
          tenantId: context.tenantId,
          credentialId,
          actorSubjectId: context.subjectId,
          reason,
          correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        }),
      } as const;
    });
    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Learning credential revocation requires a tenant administrator role.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result.revoked, {
      status: result.revoked.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
