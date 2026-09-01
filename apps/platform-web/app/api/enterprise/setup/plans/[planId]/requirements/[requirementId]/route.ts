import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { changeOrganizationSetupRequirement } from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  EnterpriseSetupDenied,
  enterpriseSetupErrorResponse,
  withSetupParticipantTransaction,
} from '../../../../../../../../lib/enterprise-setup-context';

const ACTIONS = new Set(['START', 'SATISFY', 'WAIVE', 'BLOCK', 'REOPEN']);

function roleAllows(
  role: 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER',
  action: string,
): boolean {
  if (role === 'OWNER') return true;
  if (role === 'CONTRIBUTOR') return action === 'START' || action === 'SATISFY';
  return action === 'SATISFY' || action === 'WAIVE' || action === 'BLOCK' || action === 'REOPEN';
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ planId: string; requirementId: string }> },
) {
  try {
    const { planId, requirementId } = await params;
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : '';
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unsupported setup action.' }, { status: 400 });
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
        if (!roleAllows(context.role, action)) {
          throw new EnterpriseSetupDenied(
            'ENTERPRISE_SETUP_ACTION_FORBIDDEN',
            'Your setup role does not allow this readiness action.',
          );
        }
        return changeOrganizationSetupRequirement(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          requirementId,
          action: action as any,
          actorSubjectId: context.subjectId,
          reason: typeof body.reason === 'string' ? body.reason : null,
          evidenceRefs: Array.isArray(body.evidenceRefs)
            ? body.evidenceRefs.filter(
                (value: unknown): value is string => typeof value === 'string',
              )
            : [],
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
