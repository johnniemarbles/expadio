import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requestEnterpriseOwnershipChange } from '@expadio/postgres-runtime/enterprise-ownership';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select the governing organization workspace.',
        },
        { status: 403 },
      );
    }

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required.' },
        { status: 400 },
      );
    }
    const body = await request.json();
    const ownerLegalEntityId =
      typeof body.ownerLegalEntityId === 'string' ? body.ownerLegalEntityId : '';
    const subjectLegalEntityId =
      typeof body.subjectLegalEntityId === 'string' ? body.subjectLegalEntityId : '';
    const interestType =
      typeof body.interestType === 'string' ? body.interestType : '';
    const percentage =
      body.percentage === null || body.percentage === undefined || body.percentage === ''
        ? null
        : Number(body.percentage);
    const evidenceRefs = Array.isArray(body.evidenceRefs)
      ? body.evidenceRefs.filter(
          (value: unknown): value is string => typeof value === 'string',
        )
      : [];

    const value = await withTenantTransaction(context, async (client) => {
      if (
        !(await hasGovernanceWriteRoleForOrganization(
          client,
          context.subjectId,
          context.organizationId!,
        ))
      ) {
        return { forbidden: true } as const;
      }

      const enterprise = await client.query<{ enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, context.organizationId],
      );
      const enterpriseId = enterprise.rows[0]?.enterprise_id;
      if (!enterpriseId) throw new Error('ENTERPRISE_CONTEXT_REQUIRED');

      const allowed = await client.query<{ organization_id: string }>(
        `SELECT descendant_organization_id AS organization_id
           FROM platform.organization_closure
          WHERE tenant_id = $1::uuid
            AND ancestor_organization_id = $2::uuid`,
        [context.tenantId, context.organizationId],
      );
      const allowedIds = allowed.rows.map((row) => row.organization_id);
      const scopedEntities = await client.query<{ legal_entity_id: string }>(
        `SELECT DISTINCT legal_entity_id
           FROM platform.organization_legal_entity_bindings
          WHERE tenant_id = $1::uuid
            AND organization_id = ANY($2::uuid[])
            AND legal_entity_id = ANY($3::uuid[])
            AND status = 'ACTIVE'
            AND valid_from <= now()
            AND (valid_until IS NULL OR valid_until > now())`,
        [
          context.tenantId,
          allowedIds,
          [ownerLegalEntityId, subjectLegalEntityId],
        ],
      );
      const scoped = new Set(scopedEntities.rows.map((row) => row.legal_entity_id));
      if (
        !scoped.has(ownerLegalEntityId)
        || !scoped.has(subjectLegalEntityId)
      ) {
        return { scopeDenied: true } as const;
      }

      return requestEnterpriseOwnershipChange(client, {
        tenantId: context.tenantId,
        enterpriseId,
        governingOrganizationId: context.organizationId!,
        ownerLegalEntityId,
        subjectLegalEntityId,
        interestType,
        percentage,
        validFrom:
          typeof body.validFrom === 'string' && body.validFrom.trim()
            ? body.validFrom
            : null,
        validUntil:
          typeof body.validUntil === 'string' && body.validUntil.trim()
            ? body.validUntil
            : null,
        evidenceRefs,
        requestedBySubjectId: context.subjectId,
        correlationId:
          request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        idempotencyKey,
      });
    });

    if ('forbidden' in value) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ENTERPRISE_OWNERSHIP_WRITE_FORBIDDEN',
          message: 'You are not authorized to request ownership changes.',
        },
        { status: 403 },
      );
    }
    if ('scopeDenied' in value) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ENTERPRISE_OWNERSHIP_SCOPE_MISMATCH',
          message: 'Both legal entities must belong to the selected governed branch.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json(value, { status: value.idempotent ? 200 : 202 });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
