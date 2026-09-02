import type { PoolClient } from 'pg';

export interface EnterpriseCommercialScope {
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly governingOrganizationId: string;
}

export async function resolveEnterpriseCommercialScope(
  client: PoolClient,
  input: { readonly tenantId: string; readonly organizationId: string },
): Promise<EnterpriseCommercialScope> {
  const result = await client.query<{
    enterprise_id: string;
    status: string;
  }>(
    `SELECT enterprise_id, status
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.organizationId],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'ACTIVE') {
    throw new Error('ENTERPRISE_GOVERNING_ORGANIZATION_INACTIVE');
  }
  return {
    tenantId: input.tenantId,
    enterpriseId: row.enterprise_id,
    governingOrganizationId: input.organizationId,
  };
}

export async function assertDescendantOrganization(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly ancestorOrganizationId: string;
    readonly descendantOrganizationId: string;
    readonly allowSelf?: boolean;
  },
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM platform.organization_closure closure
       JOIN platform.organizations descendant
         ON descendant.tenant_id = closure.tenant_id
        AND descendant.organization_id = closure.descendant_organization_id
      WHERE closure.tenant_id = $1::uuid
        AND closure.ancestor_organization_id = $2::uuid
        AND closure.descendant_organization_id = $3::uuid
        AND descendant.enterprise_id = $4::uuid
        AND descendant.status = 'ACTIVE'
        AND closure.depth >= $5
      LIMIT 1`,
    [
      input.tenantId,
      input.ancestorOrganizationId,
      input.descendantOrganizationId,
      input.enterpriseId,
      input.allowSelf ? 0 : 1,
    ],
  );
  if (!result.rows[0]) {
    throw new Error('ENTERPRISE_DESCENDANT_SCOPE_REQUIRED');
  }
}

export async function assertEnterpriseLegalEntity(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly legalEntityId: string;
    readonly verified?: boolean;
  },
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM platform.legal_entities
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid
        AND ($4::boolean = false OR status = 'VERIFIED')
      LIMIT 1`,
    [
      input.tenantId,
      input.enterpriseId,
      input.legalEntityId,
      input.verified ?? false,
    ],
  );
  if (!result.rows[0]) {
    throw new Error(
      input.verified
        ? 'ENTERPRISE_VERIFIED_LEGAL_ENTITY_REQUIRED'
        : 'ENTERPRISE_LEGAL_ENTITY_SCOPE_REQUIRED',
    );
  }
}

export function enterpriseCommercialHttpError(error: unknown): {
  readonly status: number;
  readonly body: { denied: true; reasonKey: string; message: string };
} {
  const code =
    error instanceof Error && error.message
      ? error.message.split(':')[0]!
      : 'ENTERPRISE_COMMERCIAL_REQUEST_FAILED';

  const badRequest = new Set([
    'ENTERPRISE_TERRITORY_INPUT_REQUIRED',
    'ENTERPRISE_APPOINTMENT_RIGHTS_REQUIRED',
    'ENTERPRISE_APPOINTMENT_TERRITORY_REQUIRED',
    'ENTERPRISE_APPOINTMENT_EXCLUSIVE_SCOPE_INVALID',
    'ENTERPRISE_APPOINTMENT_KIND_REQUIRES_POLICY',
    'ENTERPRISE_JURISDICTION_VERIFICATION_INCOMPLETE',
    'ENTERPRISE_COMMERCIAL_AGREEMENT_EXECUTION_EVIDENCE_REQUIRED',
    'ENTERPRISE_JURISDICTION_EVIDENCE_REQUIRED',
  ]);
  const forbidden = new Set([
    'ENTERPRISE_DESCENDANT_SCOPE_REQUIRED',
    'ENTERPRISE_LEGAL_ENTITY_SCOPE_REQUIRED',
    'ENTERPRISE_VERIFIED_LEGAL_ENTITY_REQUIRED',
    'ENTERPRISE_GOVERNING_ORGANIZATION_INACTIVE',
    'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED',
  ]);
  const conflict = new Set([
    'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT',
    'ENTERPRISE_TERRITORY_IDENTITY_CONFLICT',
    'ENTERPRISE_APPOINTMENT_RIGHT_NOT_ALLOWED',
    'ENTERPRISE_APPOINTMENT_DELEGATION_NOT_ALLOWED',
    'ENTERPRISE_APPOINTMENT_SUB_APPOINTMENT_NOT_ALLOWED',
    'ENTERPRISE_APPOINTMENT_AGREEMENT_NOT_APPROVED',
    'ENTERPRISE_APPOINTMENT_ACTIVE_AGREEMENT_REQUIRED',
    'ENTERPRISE_APPOINTMENT_APPROVED_DECISION_REQUIRED',
    'ENTERPRISE_APPOINTMENT_REJECTED_DECISION_REQUIRED',
    'ENTERPRISE_APPOINTMENT_RIGHTS_STAGE_REQUIRED',
    'ENTERPRISE_APPOINTMENT_NOT_RIGHTS_READY',
    'ENTERPRISE_APPOINTMENT_NOT_ACTIVATABLE',
    'ENTERPRISE_APPOINTMENT_WORKFLOW_NOT_ACTIVE',
    'ENTERPRISE_JURISDICTION_ACTIVE_APPOINTMENT_REQUIRED',
    'ENTERPRISE_JURISDICTION_TERRITORY_NOT_APPOINTED',
    'ENTERPRISE_JURISDICTION_NOT_IN_ACTIVATION_REVIEW',
    'ENTERPRISE_JURISDICTION_VERIFIED_ACTIVATION_REQUIRED',
    'ENTERPRISE_JURISDICTION_NOT_APPROVABLE',
    'ENTERPRISE_JURISDICTION_NOT_ACTIVATABLE',
    'ENTERPRISE_RIGHTS_DENIED',
    'ENTERPRISE_RIGHTS_CONFLICT',
    'ENTERPRISE_ACTIVATION_DENIED',
    'ENTERPRISE_ACTIVATION_CONFLICT',
    'ENTERPRISE_VERIFICATION_DENIED',
    'ENTERPRISE_VERIFICATION_CONFLICT',
  ]);

  const status = badRequest.has(code)
    ? 400
    : forbidden.has(code)
      ? 403
      : conflict.has(code)
        ? 409
        : code.endsWith('_NOT_FOUND')
          ? 404
          : 500;

  return {
    status,
    body: {
      denied: true,
      reasonKey: code,
      message:
        status === 500
          ? 'The enterprise commercial operation could not be completed.'
          : 'The enterprise commercial operation is not allowed in the current governed state.',
    },
  };
}
