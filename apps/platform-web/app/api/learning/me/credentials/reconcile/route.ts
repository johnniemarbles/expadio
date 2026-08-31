import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileMyLearningCredentialStatuses } from '@expadio/postgres-runtime/learning-program-certification';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { learningApiError } from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const credentials = await withTenantTransaction(context, (client) =>
      reconcileMyLearningCredentialStatuses(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      }),
    );
    return NextResponse.json({ credentials }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } });
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
