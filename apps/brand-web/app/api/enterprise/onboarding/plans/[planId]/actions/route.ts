import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  addOrganizationSetupParticipant,
  assignOrganizationOperatingEntity,
  changeOrganizationSetupRequirement,
  designateOrganizationSetupPrimaryAdministrator,
} from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../../lib/brand-context';
import { loadBrandSetupPlan } from '../../../../../../../lib/enterprise-onboarding';

const ACTIONS = new Set([
  'ADD_PARTICIPANT',
  'DESIGNATE_PRIMARY_ADMIN',
  'ASSIGN_OPERATING_ENTITY',
  'CHANGE_REQUIREMENT',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { planId } = await params;
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : '';
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unsupported enterprise setup action.' }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
    }
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

    const result = await withBrandTransaction(context, async (client) => {
      const setup = await loadBrandSetupPlan(client, context, planId);
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_SETUP_WRITE_FORBIDDEN' } as const;
      }

      if (action === 'ADD_PARTICIPANT') {
        const role = typeof body.role === 'string' ? body.role : '';
        if (!['OWNER', 'CONTRIBUTOR', 'REVIEWER'].includes(role)) {
          throw new Error('ORGANIZATION_SETUP_PARTICIPANT_ROLE_INVALID');
        }
        return addOrganizationSetupParticipant(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          subjectId: typeof body.subjectId === 'string' ? body.subjectId : '',
          issuer: context.issuer,
          role: role as 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER',
          validUntil: typeof body.validUntil === 'string' ? body.validUntil : null,
          createdBySubjectId: context.subjectId,
          correlationId,
          idempotencyKey,
        });
      }

      if (action === 'DESIGNATE_PRIMARY_ADMIN') {
        return designateOrganizationSetupPrimaryAdministrator(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          subjectId: typeof body.subjectId === 'string' ? body.subjectId : '',
          issuer: context.issuer,
          actorSubjectId: context.subjectId,
          correlationId,
          idempotencyKey,
        });
      }

      if (action === 'ASSIGN_OPERATING_ENTITY') {
        return assignOrganizationOperatingEntity(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          legalEntityId: typeof body.legalEntityId === 'string' ? body.legalEntityId : '',
          actorSubjectId: context.subjectId,
          correlationId,
          idempotencyKey,
        });
      }

      const requirementAction = typeof body.requirementAction === 'string' ? body.requirementAction : '';
      if (!['START', 'SATISFY', 'WAIVE', 'BLOCK', 'REOPEN'].includes(requirementAction)) {
        throw new Error('ORGANIZATION_SETUP_REQUIREMENT_ACTION_INVALID');
      }
      return changeOrganizationSetupRequirement(client, {
        tenantId: context.tenantId,
        setupPlanId: planId,
        requirementId: typeof body.requirementId === 'string' ? body.requirementId : '',
        action: requirementAction as 'START' | 'SATISFY' | 'WAIVE' | 'BLOCK' | 'REOPEN',
        actorSubjectId: context.subjectId,
        reason: typeof body.reason === 'string' ? body.reason : null,
        evidenceRefs: Array.isArray(body.evidenceRefs)
          ? body.evidenceRefs.filter((value: unknown): value is string => typeof value === 'string' && value.trim() !== '')
          : [],
        correlationId,
        idempotencyKey,
      });
    });

    if ('denied' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: result.denied, message: 'You are not authorized to configure this onboarding plan.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_SETUP_ACTION_FAILED';
    const conflicts = new Set([
      'ORGANIZATION_SETUP_PRIMARY_ADMIN_OWNER_REQUIRED',
      'ORGANIZATION_SETUP_AUTOMATED_REQUIREMENT',
      'ORGANIZATION_SETUP_DEPENDENCIES_INCOMPLETE',
      'ORGANIZATION_SETUP_EVIDENCE_REQUIRED',
      'ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT',
    ]);
    return NextResponse.json(
      { denied: true, reasonKey: message, message: 'The setup action could not be completed.' },
      { status: conflicts.has(message) ? 409 : 400 },
    );
  }
}
