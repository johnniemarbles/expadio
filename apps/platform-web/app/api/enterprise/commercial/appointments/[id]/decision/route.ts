import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  approveEnterpriseAppointmentFromWorkflow,
  rejectEnterpriseAppointmentFromWorkflow,
} from '@expadio/postgres-runtime/enterprise-commercial';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import { enterpriseCommercialHttpError } from '@/lib/enterprise-commercial-context';
import {
  makerForStage,
  recordCaseDecision,
  transitionWorkflow,
} from '@/lib/workflow-runtime';

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
    const body = await request.json();
    const outcome = body.outcome === 'REJECT' ? 'REJECT' : body.outcome === 'APPROVE' ? 'APPROVE' : null;
    if (!outcome) return NextResponse.json({ error: 'Outcome must be APPROVE or REJECT.' }, { status: 400 });

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
      const appointment = row.rows[0];
      if (!appointment?.workflow_instance_id) return { forbidden: true } as const;
      if (appointment.state === 'APPROVED' && outcome === 'APPROVE') {
        return approveEnterpriseAppointmentFromWorkflow(client, {
          tenantId: context.tenantId,
          appointmentId: id,
          approvedBySubjectId: context.subjectId,
          correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        });
      }

      const instance = await client.query<{
        current_stage_key: string | null;
        revision: number;
      }>(
        `SELECT current_stage_key, revision
           FROM platform.workflow_instances
          WHERE tenant_id = $1::uuid
            AND instance_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, appointment.workflow_instance_id],
      );
      const current = instance.rows[0];
      if (!current || current.current_stage_key !== 'COMMERCIAL_REVIEW') {
        throw new Error('ENTERPRISE_APPOINTMENT_REVIEW_STAGE_REQUIRED');
      }
      const maker = await makerForStage(client, {
        tenantId: context.tenantId,
        instanceId: appointment.workflow_instance_id,
        stageKey: 'COMMERCIAL_REVIEW',
      });
      const decided = await recordCaseDecision(client, {
        tenantId: context.tenantId,
        instanceId: appointment.workflow_instance_id,
        workTypeKey: 'enterprise.commercial-appointment',
        stageKey: 'COMMERCIAL_REVIEW',
        outcome,
        approverSubjectId: context.subjectId,
        makerSubjectId: maker,
      });
      if (!decided.ok) {
        if (decided.reason === 'AUTHORITY_DENIED') {
          return { authorityDenied: decided } as const;
        }
        throw new Error('ENTERPRISE_APPOINTMENT_DECISION_CONFLICT');
      }

      if (outcome === 'REJECT') {
        return rejectEnterpriseAppointmentFromWorkflow(client, {
          tenantId: context.tenantId,
          appointmentId: id,
          rejectedBySubjectId: context.subjectId,
          correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        });
      }

      const moved = await transitionWorkflow(client, {
        tenantId: context.tenantId,
        instanceId: appointment.workflow_instance_id,
        expectedRevision: current.revision,
        toStageKey: 'RIGHTS',
        requestedBySubjectId: context.subjectId,
        reason: 'Commercial appointment approved; rights issuance remains separate.',
      });
      if (!moved.ok) throw new Error('ENTERPRISE_APPOINTMENT_RIGHTS_TRANSITION_FAILED');
      return approveEnterpriseAppointmentFromWorkflow(client, {
        tenantId: context.tenantId,
        appointmentId: id,
        approvedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });

    if ('forbidden' in value) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_APPOINTMENT_DECISION_FORBIDDEN', message: 'This appointment is outside the selected governing scope.' },
        { status: 403 },
      );
    }
    if ('authorityDenied' in value) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: value.authorityDenied.code,
          message: value.authorityDenied.message,
        },
        { status: 403 },
      );
    }
    return NextResponse.json(value);
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
