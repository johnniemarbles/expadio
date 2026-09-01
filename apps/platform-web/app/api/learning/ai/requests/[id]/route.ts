import { NextResponse } from 'next/server';
import {
  loadLearningAiRequestStatus,
} from '@expadio/postgres-runtime/learning-ai';
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
import {
  resolveLearningAiOutput,
} from '@/lib/learning-ai-output';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const learningAiRequestId = requireLearningUuid(
      decodeURIComponent((await params).id),
      'learningAiRequestId',
    );

    const value = await withTenantTransaction(context, async (client) =>
      loadLearningAiRequestStatus(client, {
        tenantId: context.tenantId,
        learningAiRequestId,
        actorSubjectId: context.subjectId,
        actorIssuer: context.issuer ?? null,
        allowAdminRead:
          await hasLearningAuthoringRole(client, context.subjectId),
        outputResolver: ({ jobId, reference }) =>
          resolveLearningAiOutput(client, {
            tenantId: context.tenantId,
            organizationId: context.organizationId,
            jobId,
            reference,
          }),
      }),
    );

    return NextResponse.json(value, {
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
    return NextResponse.json(body, { status });
  }
}
