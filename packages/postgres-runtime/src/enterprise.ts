import { randomUUID } from 'node:crypto';
import { appendDomainEventWithOutbox } from './domain-events.ts';

export interface EnterpriseSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface EnterpriseSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EnterpriseSqlResult<Row>>;
}

export type OrganizationScopeMode =
  | 'SELF'
  | 'DESCENDANTS'
  | 'SELF_AND_DESCENDANTS'
  | 'SELECTED';

export interface OrganizationHierarchyNode {
  readonly organizationId: string;
  readonly parentOrganizationId: string | null;
  readonly organizationKind: string;
  readonly name: string;
  readonly status: string;
  readonly depth: number;
}

interface OrganizationHierarchyRow {
  readonly organization_id: string;
  readonly parent_organization_id: string | null;
  readonly organization_kind: string;
  readonly name: string;
  readonly status: string;
  readonly depth: number;
}

export async function listOrganizationHierarchy(
  client: EnterpriseSqlClient,
  input: {
    readonly tenantId: string;
    readonly anchorOrganizationId: string;
    readonly scopeMode: Exclude<OrganizationScopeMode, 'SELECTED'>;
  },
): Promise<readonly OrganizationHierarchyNode[]> {
  const includeSelf = input.scopeMode !== 'DESCENDANTS';
  const includeDescendants = input.scopeMode !== 'SELF';

  const result = await client.query<OrganizationHierarchyRow>(
    `SELECT
       o.organization_id,
       o.parent_organization_id,
       o.organization_kind,
       o.name,
       o.status,
       closure.depth
     FROM platform.organization_closure closure
     JOIN platform.organizations o
       ON o.tenant_id = closure.tenant_id
      AND o.organization_id = closure.descendant_organization_id
     WHERE closure.tenant_id = $1::uuid
       AND closure.ancestor_organization_id = $2::uuid
       AND (
         ($3::boolean AND closure.depth = 0)
         OR
         ($4::boolean AND closure.depth > 0)
       )
     ORDER BY closure.depth ASC, o.name ASC, o.organization_id ASC`,
    [
      input.tenantId,
      input.anchorOrganizationId,
      includeSelf,
      includeDescendants,
    ],
  );

  return result.rows.map((row) => ({
    organizationId: row.organization_id,
    parentOrganizationId: row.parent_organization_id,
    organizationKind: row.organization_kind,
    name: row.name,
    status: row.status,
    depth: Number(row.depth),
  }));
}

export interface EnterpriseChangeRequest {
  readonly requestId: string;
  readonly operation: string;
  readonly requestingOrganizationId: string;
  readonly approvingOrganizationId: string;
  readonly targetOrganizationId: string | null;
  readonly status: string;
  readonly proposedPayload: Readonly<Record<string, unknown>>;
  readonly requestedBySubjectId: string;
  readonly decidedBySubjectId: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

interface EnterpriseChangeRequestRow {
  readonly enterprise_change_request_id: string;
  readonly operation: string;
  readonly requesting_organization_id: string;
  readonly approving_organization_id: string;
  readonly target_organization_id: string | null;
  readonly status: string;
  readonly proposed_payload: Record<string, unknown>;
  readonly requested_by_subject_id: string;
  readonly decided_by_subject_id: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string;
}

function mapChangeRequest(row: EnterpriseChangeRequestRow): EnterpriseChangeRequest {
  return {
    requestId: row.enterprise_change_request_id,
    operation: row.operation,
    requestingOrganizationId: row.requesting_organization_id,
    approvingOrganizationId: row.approving_organization_id,
    targetOrganizationId: row.target_organization_id,
    status: row.status,
    proposedPayload: row.proposed_payload,
    requestedBySubjectId: row.requested_by_subject_id,
    decidedBySubjectId: row.decided_by_subject_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
  };
}

async function loadChangeRequestForUpdate(
  client: EnterpriseSqlClient,
  tenantId: string,
  requestId: string,
): Promise<EnterpriseChangeRequestRow> {
  const result = await client.query<EnterpriseChangeRequestRow>(
    `SELECT
       enterprise_change_request_id,
       operation,
       requesting_organization_id,
       approving_organization_id,
       target_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       correlation_id,
       idempotency_key
     FROM platform.enterprise_change_requests
     WHERE tenant_id = $1::uuid
       AND enterprise_change_request_id = $2::uuid
     FOR UPDATE`,
    [tenantId, requestId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('ENTERPRISE_CHANGE_REQUEST_NOT_FOUND');
  return row;
}

export async function requestChildOrganization(
  client: EnterpriseSqlClient,
  input: {
    readonly tenantId: string;
    readonly parentOrganizationId: string;
    readonly approvingOrganizationId?: string;
    readonly enterpriseId?: string | null;
    readonly name: string;
    readonly organizationKind?: string;
    readonly requestedBySubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly request: EnterpriseChangeRequest; readonly idempotent: boolean }> {
  const name = input.name.trim();
  if (name === '') throw new Error('ENTERPRISE_ORGANIZATION_NAME_REQUIRED');

  const existing = await client.query<EnterpriseChangeRequestRow>(
    `SELECT
       enterprise_change_request_id,
       operation,
       requesting_organization_id,
       approving_organization_id,
       target_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       correlation_id,
       idempotency_key
     FROM platform.enterprise_change_requests
     WHERE tenant_id = $1::uuid
       AND idempotency_key = $2`,
    [input.tenantId, input.idempotencyKey],
  );
  const existingRow = existing.rows[0];
  if (existingRow !== undefined) {
    return { request: mapChangeRequest(existingRow), idempotent: true };
  }

  const parent = await client.query<{ readonly organization_id: string }>(
    `SELECT organization_id
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND status NOT IN ('INACTIVE','CLOSED')`,
    [input.tenantId, input.parentOrganizationId],
  );
  if (parent.rows[0] === undefined) throw new Error('ENTERPRISE_PARENT_ORGANIZATION_NOT_FOUND');

  const approvingOrganizationId = input.approvingOrganizationId ?? input.parentOrganizationId;
  const requestId = randomUUID();
  const proposedPayload = {
    name,
    organizationKind: input.organizationKind?.trim() || 'BUSINESS',
    parentOrganizationId: input.parentOrganizationId,
  };

  const created = await client.query<EnterpriseChangeRequestRow>(
    `INSERT INTO platform.enterprise_change_requests (
       enterprise_change_request_id,
       tenant_id,
       enterprise_id,
       operation,
       requesting_organization_id,
       approving_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       correlation_id,
       idempotency_key
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 'CREATE_ORGANIZATION',
       $4::uuid, $5::uuid, 'SUBMITTED', $6::jsonb, $7, $8, $9
     )
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING
       enterprise_change_request_id,
       operation,
       requesting_organization_id,
       approving_organization_id,
       target_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       correlation_id,
       idempotency_key`,
    [
      requestId,
      input.tenantId,
      input.enterpriseId ?? null,
      input.parentOrganizationId,
      approvingOrganizationId,
      JSON.stringify(proposedPayload),
      input.requestedBySubjectId,
      input.correlationId,
      input.idempotencyKey,
    ],
  );
  const row = created.rows[0];
  if (row === undefined) {
    const replay = await client.query<EnterpriseChangeRequestRow>(
      `SELECT
         enterprise_change_request_id,
         operation,
         requesting_organization_id,
         approving_organization_id,
         target_organization_id,
         status,
         proposed_payload,
         requested_by_subject_id,
         decided_by_subject_id,
         correlation_id,
         idempotency_key
       FROM platform.enterprise_change_requests
       WHERE tenant_id = $1::uuid
         AND idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey],
    );
    const replayRow = replay.rows[0];
    if (replayRow === undefined) throw new Error('ENTERPRISE_CHANGE_REQUEST_CREATE_FAILED');
    return { request: mapChangeRequest(replayRow), idempotent: true };
  }

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.change_request',
      aggregateId: requestId,
      eventType: 'enterprise.change_request.submitted',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.requestedBySubjectId,
      correlationId: input.correlationId,
      payload: {
        operation: 'CREATE_ORGANIZATION',
        parentOrganizationId: input.parentOrganizationId,
        approvingOrganizationId,
      },
    },
  });

  return { request: mapChangeRequest(row), idempotent: false };
}

export async function approveCreateOrganizationRequest(
  client: EnterpriseSqlClient,
  input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly approverOrganizationId: string;
    readonly decidedBySubjectId: string;
    readonly decisionReason?: string | null;
    readonly allowSelfApproval?: boolean;
  },
): Promise<{ readonly request: EnterpriseChangeRequest; readonly organizationId: string }> {
  const row = await loadChangeRequestForUpdate(client, input.tenantId, input.requestId);

  if (row.operation !== 'CREATE_ORGANIZATION') {
    throw new Error('ENTERPRISE_CHANGE_REQUEST_OPERATION_UNSUPPORTED');
  }
  if (!['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(row.status)) {
    if (row.status === 'APPROVED' && row.target_organization_id) {
      return { request: mapChangeRequest(row), organizationId: row.target_organization_id };
    }
    throw new Error('ENTERPRISE_CHANGE_REQUEST_NOT_APPROVABLE');
  }
  if (row.approving_organization_id !== input.approverOrganizationId) {
    throw new Error('ENTERPRISE_APPROVER_SCOPE_MISMATCH');
  }
  if (!input.allowSelfApproval && row.requested_by_subject_id === input.decidedBySubjectId) {
    throw new Error('ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED');
  }

  const payload = row.proposed_payload;
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const organizationKind =
    typeof payload.organizationKind === 'string' && payload.organizationKind.trim() !== ''
      ? payload.organizationKind.trim()
      : 'BUSINESS';
  const parentOrganizationId =
    typeof payload.parentOrganizationId === 'string' ? payload.parentOrganizationId : '';

  if (name === '' || parentOrganizationId === '') {
    throw new Error('ENTERPRISE_CHANGE_REQUEST_PAYLOAD_INVALID');
  }

  const organizationId = randomUUID();
  await client.query(
    `INSERT INTO platform.organizations (
       organization_id,
       tenant_id,
       parent_organization_id,
       organization_kind,
       name,
       status,
       created_at,
       updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, 'PROVISIONING', now(), now()
     )`,
    [
      organizationId,
      input.tenantId,
      parentOrganizationId,
      organizationKind,
      name,
    ],
  );

  const updated = await client.query<EnterpriseChangeRequestRow>(
    `UPDATE platform.enterprise_change_requests
        SET status = 'APPROVED',
            target_organization_id = $3::uuid,
            decided_by_subject_id = $4,
            decided_at = now(),
            decision_reason = $5,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_change_request_id = $2::uuid
      RETURNING
       enterprise_change_request_id,
       operation,
       requesting_organization_id,
       approving_organization_id,
       target_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       correlation_id,
       idempotency_key`,
    [
      input.tenantId,
      input.requestId,
      organizationId,
      input.decidedBySubjectId,
      input.decisionReason ?? null,
    ],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow === undefined) throw new Error('ENTERPRISE_CHANGE_REQUEST_APPROVAL_FAILED');

  const occurredAt = new Date();
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.change_request',
      aggregateId: input.requestId,
      eventType: 'enterprise.change_request.approved',
      eventVersion: 1,
      occurredAt,
      actorSubjectId: input.decidedBySubjectId,
      correlationId: row.correlation_id,
      payload: {
        operation: row.operation,
        organizationId,
      },
    },
  });
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'organization',
      aggregateId: organizationId,
      eventType: 'organization.provisioned',
      eventVersion: 1,
      occurredAt,
      actorSubjectId: input.decidedBySubjectId,
      correlationId: row.correlation_id,
      payload: {
        parentOrganizationId,
        organizationKind,
        lifecycleState: 'PROVISIONING',
      },
    },
  });

  return { request: mapChangeRequest(updatedRow), organizationId };
}
