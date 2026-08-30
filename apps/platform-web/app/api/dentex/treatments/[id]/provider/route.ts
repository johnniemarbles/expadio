import { NextResponse } from 'next/server';
import { resolveRelationshipDefinitions } from '@expadio/industry-packs';
import { PostgresEntityRelationshipRepository } from '@expadio/postgres-runtime/entity-relationship';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../../lib/crm-authz';
import { assignParticipant } from '../../../../../../lib/workflow-participants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Assign the caller as the authoritative treating Provider for one DENTEX
 * Treatment and project that relationship into a requested workflow stage slot.
 *
 * Relationship Fabric is the source of truth. Workflow participation is the
 * execution projection. Both writes share one tenant-scoped transaction.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const treatmentId = decodeURIComponent((await params).id);
    const body = await request.json();
    const stageKey = typeof body?.stageKey === 'string' ? body.stageKey.trim() : '';

    if (stageKey === '') {
      return NextResponse.json(
        { error: 'A workflow stage is required for Provider assignment.' },
        { status: 400 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      const treatment = await client.query<{
        workflow_instance_id: string | null;
        industry_pack_vertical_key: string | null;
      }>(
        `SELECT workflow_instance_id, industry_pack_vertical_key
           FROM platform.crm_cases
          WHERE tenant_id = $1::uuid
            AND case_id = $2::uuid`,
        [context.tenantId, treatmentId],
      );

      const row = treatment.rows[0];
      if (row === undefined) return { notFound: true } as const;
      if (row.industry_pack_vertical_key !== 'dentex') {
        return { packMismatch: true } as const;
      }
      if (row.workflow_instance_id === null) {
        return { noWorkflow: true } as const;
      }

      const runtimePack = await new PostgresIndustryPackRuntimeResolver(client).resolve({
        tenantId: context.tenantId,
        verticalKey: 'dentex',
      });
      const providerDefinition = resolveRelationshipDefinitions(runtimePack.pack, 'crm.case')
        .find((definition) => definition.key === 'provider');
      if (providerDefinition === undefined) {
        throw new Error('DENTEX_PROVIDER_RELATIONSHIP_NOT_CONFIGURED');
      }

      const relationships = new PostgresEntityRelationshipRepository(client);
      const provider = await relationships.replaceSingle({
        tenantId: context.tenantId,
        definition: providerDefinition,
        sourceEntityId: treatmentId,
        target: {
          entityType: 'iam.subject',
          entityId: context.subjectId,
        },
        actorSubjectId: context.subjectId,
      });

      const participant = await assignParticipant(client, {
        tenantId: context.tenantId,
        instanceId: row.workflow_instance_id,
        stageKey,
        participantKey: 'provider',
        targetKind: 'USER',
        targetKey: provider.target.entityId,
        assignedBySubjectId: context.subjectId,
      });

      return {
        providerSubjectId: provider.target.entityId,
        relationshipId: provider.relationshipId,
        workflowInstanceId: row.workflow_instance_id,
        stageKey,
        participantStatus: participant.status,
      } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'You need a tenant admin role to assign a treating Provider.',
        },
        { status: 403 },
      );
    }
    if ('notFound' in result) {
      return NextResponse.json(
        { error: 'That Treatment was not found in this workspace.' },
        { status: 404 },
      );
    }
    if ('packMismatch' in result) {
      return NextResponse.json(
        { error: 'That case is not governed as a DENTEX Treatment.' },
        { status: 409 },
      );
    }
    if ('noWorkflow' in result) {
      return NextResponse.json(
        { error: 'Start the Treatment workflow before assigning a Provider.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
