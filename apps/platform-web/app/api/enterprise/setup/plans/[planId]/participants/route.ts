import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { addOrganizationSetupParticipant } from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  EnterpriseSetupDenied,
  enterpriseSetupErrorResponse,
  withSetupParticipantTransaction,
} from '../../../../../../../lib/enterprise-setup-context';

const ROLES = new Set(['OWNER', 'CONTRIBUTOR', 'REVIEWER']);
const ISSUER = 'https://clerk.expadio.com';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const body = await request.json();
    const role = typeof body.role === 'string' ? body.role : '';
    if (!ROLES.has(role)) {
      return NextResponse.json({ error: 'Unsupported setup participant role.' }, { status: 400 });
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
            'Only a setup owner can manage setup participants.',
          );
        }

        return addOrganizationSetupParticipant(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          subjectId: typeof body.subjectId === 'string' ? body.subjectId : '',
          issuer: ISSUER,
          role: role as any,
          validUntil: typeof body.validUntil === 'string' ? body.validUntil : null,
          createdBySubjectId: context.subjectId,
          correlationId:
            request.headers.get('x-correlation-id')?.trim() || randomUUID(),
          idempotencyKey,
        });
      },
    );

    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const denied = enterpriseSetupErrorResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
