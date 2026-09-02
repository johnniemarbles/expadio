import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createEnterpriseJurisdictionActivation,
  startEnterpriseJurisdictionActivationReview,
} from '@expadio/postgres-runtime/enterprise-commercial';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import { enterpriseCommercialHttpError } from '@/lib/enterprise-commercial-context';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select the appointing organization.' },
        { status: 403 },
      );
    }
    const body = await request.json();
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
    }
    const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : '';
    const territoryId = typeof body.territoryId === 'string' ? body.territoryId : '';

    const value = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const target = await client.query<{
        enterprise_id: string;
        beneficiary_organization_id: string;
      }>(
        `SELECT enterprise_id, beneficiary_organization_id
           FROM platform.enterprise_appointments
          WHERE tenant_id = $1::uuid
            AND enterprise_appointment_id = $2::uuid
            AND grantor_organization_id = $3::uuid
            AND state = 'ACTIVE'
          LIMIT 1`,
        [context.tenantId, appointmentId, context.organizationId],
      );
      const appointment = target.rows[0];
      if (!appointment) return { forbidden: true } as const;

      const planned = await createEnterpriseJurisdictionActivation(client, {
        tenantId: context.tenantId,
        enterpriseId: appointment.enterprise_id,
        appointmentId,
        organizationId: appointment.beneficiary_organization_id,
        territoryId,
        idempotencyKey,
        requestedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      const reviewing = await startEnterpriseJurisdictionActivationReview(client, {
        tenantId: context.tenantId,
        jurisdictionActivationId: planned.activation.jurisdictionActivationId,
        requestedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      return { activation: reviewing, idempotent: planned.idempotent };
    });

    if ('forbidden' in value) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_JURISDICTION_FORBIDDEN', message: 'This appointment is outside the selected governing scope.' },
        { status: 403 },
      );
    }
    return NextResponse.json(value, { status: value.idempotent ? 200 : 201 });
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
