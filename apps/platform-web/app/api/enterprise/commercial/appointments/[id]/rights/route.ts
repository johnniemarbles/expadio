import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  activateEnterpriseAppointment,
  issueEnterpriseAppointmentRights,
} from '@expadio/postgres-runtime/enterprise-commercial';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import { enterpriseCommercialHttpError } from '@/lib/enterprise-commercial-context';
import { transitionWorkflow } from '@/lib/workflow-runtime';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select the appointing organization.' },
        { status: 403 },
      );
    }
    const { id } = await params;
    const value = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const row = await client.query<{
        workflow_instance_id: string | null;
        state: string;
      }>(
        `SELECT workflow_instance_id, state
           FROM platform.enterprise_appointments
          WHERE tenant_id = $1::uuid
            AND enterprise_appointment_id = $2::uuid
            AND grantor_organization_id = $3::uuid
          LIMIT 1`,
        [context.tenantId, id, context.organizationId],
      );
      const target = row.rows[0];
      if (!target?.workflow_instance_id) return { forbidden: true } as const;
      if (target.state === 'ACTIVE') {
        const current = await client.query(
          `SELECT * FROM platform.enterprise_appointments
            WHERE tenant_id = $1::uuid AND enterprise_appointment_id = $2::uuid`,
          [context.tenantId, id],
        );
        return { alreadyActive: true, appointment: current.rows[0] } as const;
      }

      const issued = await issueEnterpriseAppointmentRights(client, {
        tenantId: context.tenantId,
        appointmentId: id,
        issuedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      const instance = await client.query<{ revision: number; current_stage_key: string | null }>(
        `SELECT revision, current_stage_key
           FROM platform.workflow_instances
          WHERE tenant_id = $1::uuid AND instance_id = $2::uuid`,
        [context.tenantId, target.workflow_instance_id],
      );
      const workflow = instance.rows[0];
      if (!workflow) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
      if (workflow.current_stage_key !== 'ACTIVE') {
        const moved = await transitionWorkflow(client, {
          tenantId: context.tenantId,
          instanceId: target.workflow_instance_id,
          expectedRevision: workflow.revision,
          toStageKey: 'ACTIVE',
          requestedBySubjectId: context.subjectId,
          reason: 'Immutable commercial rights grant issued.',
        });
        if (!moved.ok) throw new Error('ENTERPRISE_APPOINTMENT_ACTIVE_TRANSITION_FAILED');
      }
      const active = await activateEnterpriseAppointment(client, {
        tenantId: context.tenantId,
        appointmentId: id,
        activatedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      return { appointment: active, grant: issued.grant, idempotent: issued.idempotent };
    });

    if ('forbidden' in value) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_RIGHTS_FORBIDDEN', message: 'This appointment is outside the selected governing scope.' },
        { status: 403 },
      );
    }
    return NextResponse.json(value);
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
