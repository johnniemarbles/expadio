import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { designateOrganizationSetupPrimaryAdministrator } from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  EnterpriseSetupDenied,
  enterpriseSetupErrorResponse,
  withSetupParticipantTransaction,
} from '../../../../../../../lib/enterprise-setup-context';

const ISSUER = 'https://clerk.expadio.com';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const body = await request.json();
    const subjectId =
      typeof body.subjectId === 'string' ? body.subjectId.trim() : '';
    if (!subjectId) {
      return NextResponse.json(
        { error: 'Primary administrator subject is required.' },
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
            'Only a setup owner can designate the primary administrator.',
          );
        }

        return designateOrganizationSetupPrimaryAdministrator(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          subjectId,
          issuer: ISSUER,
          actorSubjectId: context.subjectId,
          correlationId:
            request.headers.get('x-correlation-id')?.trim() || randomUUID(),
          idempotencyKey,
        });
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    const denied = enterpriseSetupErrorResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
