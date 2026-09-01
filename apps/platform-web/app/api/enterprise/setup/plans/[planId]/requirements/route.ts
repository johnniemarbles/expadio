import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  addOrganizationSetupDependency,
  registerOrganizationSetupRequirement,
} from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  EnterpriseSetupDenied,
  enterpriseSetupErrorResponse,
  withSetupParticipantTransaction,
} from '../../../../../../../lib/enterprise-setup-context';

const ALLOWED_SOURCES = new Set(['TENANT', 'PARENT_POLICY', 'CUSTOM']);
const ALLOWED_CATEGORIES = new Set([
  'ORGANIZATION','LEGAL','GOVERNANCE','ACCESS','FINANCE','COMPLIANCE',
  'MODULE','VERTICAL','OPERATIONS','DATA','COMMUNICATION','CUSTOM',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const body = await request.json();
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required' },
        { status: 400 },
      );
    }

    const outcome = await withSetupParticipantTransaction(
      planId,
      async (client, context) => {
        if (context.role !== 'OWNER') {
          throw new EnterpriseSetupDenied(
            'ENTERPRISE_SETUP_REQUIREMENT_ADMIN_REQUIRED',
            'Only a setup owner can add governed readiness requirements.',
          );
        }

        const sourceKind =
          typeof body.sourceKind === 'string' ? body.sourceKind : 'CUSTOM';
        const category =
          typeof body.category === 'string' ? body.category : 'CUSTOM';
        if (!ALLOWED_SOURCES.has(sourceKind)) {
          throw new EnterpriseSetupDenied(
            'ENTERPRISE_SETUP_REQUIREMENT_SOURCE_FORBIDDEN',
            'Module and vertical requirements must be injected by their platform runtime.',
            403,
          );
        }
        if (!ALLOWED_CATEGORIES.has(category)) {
          return { badRequest: 'Unsupported requirement category.' } as const;
        }

        const correlationId =
          request.headers.get('x-correlation-id')?.trim() || randomUUID();

        const created = await registerOrganizationSetupRequirement(client, {
          tenantId: context.tenantId,
          setupPlanId: planId,
          requirementKey:
            typeof body.requirementKey === 'string' ? body.requirementKey : '',
          category: category as any,
          sourceKind: sourceKind as any,
          sourceKey:
            typeof body.sourceKey === 'string' ? body.sourceKey : null,
          title: typeof body.title === 'string' ? body.title : '',
          description:
            typeof body.description === 'string' ? body.description : '',
          blocking: body.blocking !== false,
          ownerSubjectId:
            typeof body.ownerSubjectId === 'string' ? body.ownerSubjectId : null,
          dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
          metadata:
            body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
              ? body.metadata
              : {},
          sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : 0,
          createdBySubjectId: context.subjectId,
          correlationId,
          idempotencyKey,
        });

        const dependencies = Array.isArray(body.dependsOnRequirementIds)
          ? body.dependsOnRequirementIds.filter(
              (value: unknown): value is string => typeof value === 'string',
            )
          : [];
        for (const dependencyId of dependencies) {
          await addOrganizationSetupDependency(client, {
            tenantId: context.tenantId,
            setupPlanId: planId,
            requirementId: created.requirement.setupRequirementId,
            dependsOnRequirementId: dependencyId,
            actorSubjectId: context.subjectId,
            correlationId,
            idempotencyKey:
              idempotencyKey + ':dependency:' + dependencyId,
          });
        }

        return { created };
      },
    );

    if ('badRequest' in outcome) {
      return NextResponse.json({ error: outcome.badRequest }, { status: 400 });
    }
    return NextResponse.json(outcome.created, {
      status: outcome.created.idempotent ? 200 : 201,
    });
  } catch (error) {
    const denied = enterpriseSetupErrorResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
