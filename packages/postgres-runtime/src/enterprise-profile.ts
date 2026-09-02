import { randomUUID } from 'node:crypto';
import { appendDomainEventWithOutbox } from './domain-events.ts';

export interface EnterpriseProfileSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface EnterpriseProfileSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EnterpriseProfileSqlResult<Row>>;
}

export interface EnterpriseProfileConfiguration {
  readonly enterpriseId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly mode: 'SIMPLE' | 'GLOBAL';
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  readonly configurationState: 'BOOTSTRAPPED' | 'CONFIGURED';
  readonly rootOrganizationId: string | null;
  readonly configuredAt: string | null;
  readonly configuredBySubjectId: string | null;
}

export interface EnterpriseProfileConfigurationRequest {
  readonly requestId: string;
  readonly enterpriseId: string;
  readonly requestingOrganizationId: string;
  readonly approvingOrganizationId: string;
  readonly status: string;
  readonly proposedName: string;
  readonly proposedMode: 'SIMPLE' | 'GLOBAL';
  readonly proposedRootOrganizationId: string;
  readonly requestedBySubjectId: string;
  readonly decidedBySubjectId: string | null;
  readonly decisionReason: string | null;
  readonly idempotencyKey: string;
}

interface ProfileRow {
  readonly enterprise_id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly mode: 'SIMPLE' | 'GLOBAL';
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  readonly configuration_state: 'BOOTSTRAPPED' | 'CONFIGURED';
  readonly root_organization_id: string | null;
  readonly configured_at: Date | string | null;
  readonly configured_by_subject_id: string | null;
}

interface RequestRow {
  readonly enterprise_change_request_id: string;
  readonly enterprise_id: string;
  readonly requesting_organization_id: string;
  readonly approving_organization_id: string;
  readonly status: string;
  readonly proposed_payload: {
    readonly name?: unknown;
    readonly mode?: unknown;
    readonly rootOrganizationId?: unknown;
  };
  readonly requested_by_subject_id: string;
  readonly decided_by_subject_id: string | null;
  readonly decision_reason: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapProfile(row: ProfileRow): EnterpriseProfileConfiguration {
  return {
    enterpriseId: row.enterprise_id,
    tenantId: row.tenant_id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    configurationState: row.configuration_state,
    rootOrganizationId: row.root_organization_id,
    configuredAt: iso(row.configured_at),
    configuredBySubjectId: row.configured_by_subject_id,
  };
}

function requestPayload(row: RequestRow): {
  readonly name: string;
  readonly mode: 'SIMPLE' | 'GLOBAL';
  readonly rootOrganizationId: string;
} {
  const name = typeof row.proposed_payload.name === 'string' ? row.proposed_payload.name.trim() : '';
  const mode = row.proposed_payload.mode;
  const rootOrganizationId =
    typeof row.proposed_payload.rootOrganizationId === 'string'
      ? row.proposed_payload.rootOrganizationId
      : '';
  if (!name || (mode !== 'SIMPLE' && mode !== 'GLOBAL') || !rootOrganizationId) {
    throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_PAYLOAD_INVALID');
  }
  return { name, mode, rootOrganizationId };
}

function mapRequest(row: RequestRow): EnterpriseProfileConfigurationRequest {
  const payload = requestPayload(row);
  return {
    requestId: row.enterprise_change_request_id,
    enterpriseId: row.enterprise_id,
    requestingOrganizationId: row.requesting_organization_id,
    approvingOrganizationId: row.approving_organization_id,
    status: row.status,
    proposedName: payload.name,
    proposedMode: payload.mode,
    proposedRootOrganizationId: payload.rootOrganizationId,
    requestedBySubjectId: row.requested_by_subject_id,
    decidedBySubjectId: row.decided_by_subject_id,
    decisionReason: row.decision_reason,
    idempotencyKey: row.idempotency_key,
  };
}

export async function loadEnterpriseProfileConfiguration(
  client: EnterpriseProfileSqlClient,
  input: { readonly tenantId: string; readonly enterpriseId: string },
): Promise<EnterpriseProfileConfiguration> {
  const result = await client.query<ProfileRow>(
    `SELECT
       enterprise_id, tenant_id, name, mode, status,
       configuration_state, root_organization_id,
       configured_at, configured_by_subject_id
     FROM platform.enterprise_profiles
     WHERE tenant_id = $1::uuid
       AND enterprise_id = $2::uuid
     LIMIT 1`,
    [input.tenantId, input.enterpriseId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_PROFILE_NOT_FOUND');
  return mapProfile(row);
}

export async function listEnterpriseProfileConfigurationRequests(
  client: EnterpriseProfileSqlClient,
  input: { readonly tenantId: string; readonly enterpriseId: string; readonly rootOrganizationId: string },
): Promise<readonly EnterpriseProfileConfigurationRequest[]> {
  const result = await client.query<RequestRow>(
    `SELECT
       enterprise_change_request_id,
       enterprise_id,
       requesting_organization_id,
       approving_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       decision_reason,
       correlation_id,
       idempotency_key
     FROM platform.enterprise_change_requests
     WHERE tenant_id = $1::uuid
       AND enterprise_id = $2::uuid
       AND operation = 'CONFIGURE_ENTERPRISE_PROFILE'
       AND (
         requesting_organization_id = $3::uuid
         OR approving_organization_id = $3::uuid
       )
     ORDER BY requested_at DESC, enterprise_change_request_id DESC`,
    [input.tenantId, input.enterpriseId, input.rootOrganizationId],
  );
  return result.rows.map(mapRequest);
}

export async function requestEnterpriseProfileConfiguration(
  client: EnterpriseProfileSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly rootOrganizationId: string;
    readonly name: string;
    readonly mode: 'SIMPLE' | 'GLOBAL';
    readonly requestedBySubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly request: EnterpriseProfileConfigurationRequest; readonly idempotent: boolean }> {
  const name = input.name.trim();
  if (!name) throw new Error('ENTERPRISE_PROFILE_NAME_REQUIRED');

  const profile = await loadEnterpriseProfileConfiguration(client, {
    tenantId: input.tenantId,
    enterpriseId: input.enterpriseId,
  });
  if (profile.status !== 'ACTIVE') throw new Error('ENTERPRISE_PROFILE_NOT_ACTIVE');

  const root = await client.query<{ organization_id: string }>(
    `SELECT organization_id
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND organization_id = $3::uuid
        AND parent_organization_id IS NULL
        AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.enterpriseId, input.rootOrganizationId],
  );
  if (!root.rows[0]) throw new Error('ENTERPRISE_PROFILE_ROOT_AUTHORITY_REQUIRED');

  const existing = await client.query<RequestRow>(
    `SELECT
       enterprise_change_request_id,
       enterprise_id,
       requesting_organization_id,
       approving_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       decision_reason,
       correlation_id,
       idempotency_key
     FROM platform.enterprise_change_requests
     WHERE tenant_id = $1::uuid
       AND idempotency_key = $2
     LIMIT 1`,
    [input.tenantId, input.idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior) {
    const payload = requestPayload(prior);
    const exact =
      prior.enterprise_id === input.enterpriseId
      && prior.requesting_organization_id === input.rootOrganizationId
      && prior.approving_organization_id === input.rootOrganizationId
      && payload.name === name
      && payload.mode === input.mode
      && payload.rootOrganizationId === input.rootOrganizationId;
    if (!exact) throw new Error('ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT');
    return { request: mapRequest(prior), idempotent: true };
  }

  const requestId = randomUUID();
  const created = await client.query<RequestRow>(
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
       $1::uuid, $2::uuid, $3::uuid, 'CONFIGURE_ENTERPRISE_PROFILE',
       $4::uuid, $4::uuid, 'SUBMITTED', $5::jsonb, $6, $7, $8
     )
     RETURNING
       enterprise_change_request_id,
       enterprise_id,
       requesting_organization_id,
       approving_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       decision_reason,
       correlation_id,
       idempotency_key`,
    [
      requestId,
      input.tenantId,
      input.enterpriseId,
      input.rootOrganizationId,
      JSON.stringify({ name, mode: input.mode, rootOrganizationId: input.rootOrganizationId }),
      input.requestedBySubjectId,
      input.correlationId,
      input.idempotencyKey,
    ],
  );
  const row = created.rows[0];
  if (!row) throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_REQUEST_FAILED');

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.profile',
      aggregateId: input.enterpriseId,
      eventType: 'enterprise.profile.configuration_requested',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.requestedBySubjectId,
      correlationId: input.correlationId,
      payload: {
        requestId,
        name,
        mode: input.mode,
        rootOrganizationId: input.rootOrganizationId,
      },
    },
  });

  return { request: mapRequest(row), idempotent: false };
}

export async function approveEnterpriseProfileConfiguration(
  client: EnterpriseProfileSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly requestId: string;
    readonly approverOrganizationId: string;
    readonly decidedBySubjectId: string;
    readonly decisionReason?: string | null;
  },
): Promise<{
  readonly profile: EnterpriseProfileConfiguration;
  readonly request: EnterpriseProfileConfigurationRequest;
  readonly idempotent: boolean;
}> {
  const request = await client.query<RequestRow>(
    `SELECT
       enterprise_change_request_id,
       enterprise_id,
       requesting_organization_id,
       approving_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       decision_reason,
       correlation_id,
       idempotency_key
     FROM platform.enterprise_change_requests
     WHERE tenant_id = $1::uuid
       AND enterprise_id = $2::uuid
       AND enterprise_change_request_id = $3::uuid
     LIMIT 1
     FOR UPDATE`,
    [input.tenantId, input.enterpriseId, input.requestId],
  );
  const row = request.rows[0];
  if (!row) throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_REQUEST_NOT_FOUND');
  if (row.approving_organization_id !== input.approverOrganizationId) {
    throw new Error('ENTERPRISE_APPROVER_SCOPE_MISMATCH');
  }
  if (row.requested_by_subject_id === input.decidedBySubjectId) {
    throw new Error('ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED');
  }

  const payload = requestPayload(row);
  if (row.status === 'APPROVED') {
    const profile = await loadEnterpriseProfileConfiguration(client, {
      tenantId: input.tenantId,
      enterpriseId: input.enterpriseId,
    });
    const exact =
      profile.configurationState === 'CONFIGURED'
      && profile.name === payload.name
      && profile.mode === payload.mode
      && profile.rootOrganizationId === payload.rootOrganizationId;
    if (!exact) throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_CONFLICT');
    return { profile, request: mapRequest(row), idempotent: true };
  }
  if (!['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(row.status)) {
    throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_NOT_APPROVABLE');
  }

  const root = await client.query<{ organization_id: string }>(
    `SELECT organization_id
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND organization_id = $3::uuid
        AND parent_organization_id IS NULL
        AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.enterpriseId, payload.rootOrganizationId],
  );
  if (!root.rows[0]) throw new Error('ENTERPRISE_PROFILE_ROOT_AUTHORITY_REQUIRED');

  const updated = await client.query<ProfileRow>(
    `UPDATE platform.enterprise_profiles
        SET name = $3,
            mode = $4,
            root_organization_id = $5::uuid,
            configuration_state = 'CONFIGURED',
            configured_at = now(),
            configured_by_subject_id = $6,
            updated_by_subject_id = $6,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND status = 'ACTIVE'
      RETURNING
       enterprise_id, tenant_id, name, mode, status,
       configuration_state, root_organization_id,
       configured_at, configured_by_subject_id`,
    [
      input.tenantId,
      input.enterpriseId,
      payload.name,
      payload.mode,
      payload.rootOrganizationId,
      input.decidedBySubjectId,
    ],
  );
  const profileRow = updated.rows[0];
  if (!profileRow) throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_UPDATE_FAILED');

  const decided = await client.query<RequestRow>(
    `UPDATE platform.enterprise_change_requests
        SET status = 'APPROVED',
            decided_by_subject_id = $4,
            decided_at = now(),
            decision_reason = $5,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND enterprise_change_request_id = $3::uuid
      RETURNING
       enterprise_change_request_id,
       enterprise_id,
       requesting_organization_id,
       approving_organization_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       decided_by_subject_id,
       decision_reason,
       correlation_id,
       idempotency_key`,
    [
      input.tenantId,
      input.enterpriseId,
      input.requestId,
      input.decidedBySubjectId,
      input.decisionReason?.trim() || null,
    ],
  );
  const decidedRow = decided.rows[0];
  if (!decidedRow) throw new Error('ENTERPRISE_PROFILE_CONFIGURATION_DECISION_FAILED');

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.profile',
      aggregateId: input.enterpriseId,
      eventType: 'enterprise.profile.configured',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.decidedBySubjectId,
      correlationId: row.correlation_id,
      payload: {
        requestId: input.requestId,
        name: payload.name,
        mode: payload.mode,
        rootOrganizationId: payload.rootOrganizationId,
      },
    },
  });

  return {
    profile: mapProfile(profileRow),
    request: mapRequest(decidedRow),
    idempotent: false,
  };
}
