import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assignOrganizationOperatingEntity } from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  EnterpriseSetupDenied,
  enterpriseSetupErrorResponse,
  withSetupParticipantTransaction,
} from '../../../../../../../lib/enterprise-setup-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const body = await request.json();
    const legalEntityId =
      typeof body.legalEntityId === 'string' ? body.legalEntityId.trim() : '';
    if (!legalEntityId) {
      return NextResponse.json(
        { error: 'Verified legal entity is required.' },
        { status: 400 },
      );
    }

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required' },
        { status: 400 },
      );
    }

    const result = await withSetupParticipantTransaction(
      planId,
      async (client, context) => {
        if (context.role !== 'OWNER') {
          throw new EnterpriseSetupDenied(
            'ENTERPRISE_SETUP_OWNER_REQUIRED',
            'Only a setup owner can assign the operating legal entity.',
          );
        }

        return assignOrganizationOperatingEntity(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          legalEntityId,
          actorSubjectId: context.subjectId,
          correlationId:
            request.headers.get('x-correlation-id')?.trim() || randomUUID(),
          idempotencyKey,
        });
      },
    );

    return NextResponse.json(result, {
      status: result.idempotent ? 200 : 201,
    });
  } catch (error) {
    const denied = enterpriseSetupErrorResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
