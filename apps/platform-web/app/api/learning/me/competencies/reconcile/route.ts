import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileMyLearningCompetencies } from '@expadio/postgres-runtime/learning-competency';
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
    const reconciliation = await withTenantTransaction(context, (client) =>
      reconcileMyLearningCompetencies(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        correlationId:
          request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      }),
    );
    return NextResponse.json(reconciliation, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) {
      return NextResponse.json(mapped.body, {
        status: mapped.status,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
