import { randomUUID } from 'node:crypto';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { publishGovernedEntityRelationship } from './entity-graph.ts';

export interface EnterpriseOwnershipSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface EnterpriseOwnershipSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EnterpriseOwnershipSqlResult<Row>>;
}

export const ENTERPRISE_OWNERSHIP_INTEREST_TYPES = [
  'EQUITY',
  'VOTING',
  'ECONOMIC',
  'CONTROL',
  'BENEFICIAL',
] as const;
export type EnterpriseOwnershipInterestType =
  (typeof ENTERPRISE_OWNERSHIP_INTEREST_TYPES)[number];

export type EnterpriseOwnershipDecision = 'APPROVE' | 'REJECT';

export interface EnterpriseOwnershipInterest {
  readonly interestId: string;
  readonly changeRequestId: string;
  readonly ownerLegalEntityId: string;
  readonly subjectLegalEntityId: string;
  readonly interestType: EnterpriseOwnershipInterestType;
  readonly percentage: number | null;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  readonly createdBySubjectId: string;
  readonly approvedBySubjectId: string | null;
  readonly approvedAt: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface InterestRow {
  readonly interest_id: string;
  readonly enterprise_change_request_id: string;
  readonly owner_entity_key: string;
  readonly subject_entity_key: string;
  readonly interest_type: EnterpriseOwnershipInterestType;
  readonly percentage: string | number | null;
  readonly valid_from: Date | string;
  readonly valid_until: Date | string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  readonly created_by_subject_id: string;
  readonly approved_by_subject_id: string | null;
  readonly approved_at: Date | string | null;
  readonly evidence: Record<string, unknown>;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapInterest(row: InterestRow): EnterpriseOwnershipInterest {
  return {
    interestId: row.interest_id,
    changeRequestId: row.enterprise_change_request_id,
    ownerLegalEntityId: row.owner_entity_key,
    subjectLegalEntityId: row.subject_entity_key,
    interestType: row.interest_type,
    percentage: row.percentage === null ? null : Number(row.percentage),
    validFrom: iso(row.valid_from),
    validUntil: row.valid_until === null ? null : iso(row.valid_until),
    status: row.status,
    createdBySubjectId: row.created_by_subject_id,
    approvedBySubjectId: row.approved_by_subject_id,
    approvedAt: row.approved_at === null ? null : iso(row.approved_at),
    evidence: row.evidence,
  };
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeType(value: string): EnterpriseOwnershipInterestType {
  const normalized = value.trim().toUpperCase();
  if (!(ENTERPRISE_OWNERSHIP_INTEREST_TYPES as readonly string[]).includes(normalized)) {
    throw new Error('ENTERPRISE_OWNERSHIP_INTEREST_TYPE_INVALID');
  }
  return normalized as EnterpriseOwnershipInterestType;
}

function relationshipKeyForInterestType(
  interestType: EnterpriseOwnershipInterestType,
): string {
  return `OWNERSHIP_${interestType}`;
}

function normalizePercentage(
  interestType: EnterpriseOwnershipInterestType,
  value: number | null | undefined,
): number | null {
  if (interestType === 'CONTROL') {
    if (value == null) return null;
  } else if (value == null) {
    throw new Error('ENTERPRISE_OWNERSHIP_PERCENTAGE_REQUIRED');
  }
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('ENTERPRISE_OWNERSHIP_PERCENTAGE_INVALID');
  }
  return value;
}

async function resolveVerifiedLegalEntityNode(
  client: EnterpriseOwnershipSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly legalEntityId: string;
    readonly actorSubjectId: string;
  },
): Promise<string> {
  const entity = await client.query<{ legal_entity_id: string }>(
    `SELECT legal_entity_id
       FROM platform.legal_entities
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid
        AND status = 'VERIFIED'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
      LIMIT 1`,
    [input.tenantId, input.enterpriseId, input.legalEntityId],
  );
  if (!entity.rows[0]) throw new Error('ENTERPRISE_OWNERSHIP_VERIFIED_LEGAL_ENTITY_REQUIRED');

  const node = await client.query<{ node_id: string }>(
    `SELECT platform.resolve_or_register_entity_registry_node(
       $1::uuid, 'LEGAL_ENTITY', $2::text, $3::text
     ) AS node_id`,
    [input.tenantId, input.legalEntityId, input.actorSubjectId],
  );
  const row = node.rows[0];
  if (!row) throw new Error('ENTERPRISE_OWNERSHIP_REGISTRY_NODE_REQUIRED');
  return row.node_id;
}

async function loadInterestByRequest(
  client: EnterpriseOwnershipSqlClient,
  tenantId: string,
  requestId: string,
  forUpdate = false,
): Promise<InterestRow> {
  const result = await client.query<InterestRow>(
    `SELECT
       interest.interest_id,
       interest.enterprise_change_request_id,
       owner.entity_key AS owner_entity_key,
       subject.entity_key AS subject_entity_key,
       interest.interest_type,
       interest.percentage,
       interest.valid_from,
       interest.valid_until,
       interest.status,
       interest.created_by_subject_id,
       interest.approved_by_subject_id,
       interest.approved_at,
       interest.evidence
     FROM platform.entity_ownership_interests interest
     JOIN platform.entity_registry_nodes owner
       ON owner.node_id = interest.owner_node_id
      AND owner.tenant_id = interest.tenant_id
     JOIN platform.entity_registry_nodes subject
       ON subject.node_id = interest.subject_node_id
      AND subject.tenant_id = interest.tenant_id
     WHERE interest.tenant_id = $1::uuid
       AND interest.enterprise_change_request_id = $2::uuid
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE OF interest' : ''}`,
    [tenantId, requestId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_OWNERSHIP_INTEREST_NOT_FOUND');
  return row;
}

export async function requestEnterpriseOwnershipChange(
  client: EnterpriseOwnershipSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly governingOrganizationId: string;
    readonly ownerLegalEntityId: string;
    readonly subjectLegalEntityId: string;
    readonly interestType: string;
    readonly percentage?: number | null;
    readonly validFrom?: string | null;
    readonly validUntil?: string | null;
    readonly evidenceRefs?: readonly string[];
    readonly requestedBySubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly requestId: string;
  readonly interest: EnterpriseOwnershipInterest;
  readonly idempotent: boolean;
}> {
  const ownerLegalEntityId = required(
    input.ownerLegalEntityId,
    'ENTERPRISE_OWNERSHIP_OWNER_REQUIRED',
  );
  const subjectLegalEntityId = required(
    input.subjectLegalEntityId,
    'ENTERPRISE_OWNERSHIP_SUBJECT_REQUIRED',
  );
  if (ownerLegalEntityId === subjectLegalEntityId) {
    throw new Error('ENTERPRISE_OWNERSHIP_SELF_RELATIONSHIP_FORBIDDEN');
  }
  const interestType = normalizeType(input.interestType);
  const percentage = normalizePercentage(interestType, input.percentage);
  const idempotencyKey = required(
    input.idempotencyKey,
    'ENTERPRISE_OWNERSHIP_IDEMPOTENCY_REQUIRED',
  );
  const requestedValidFrom = input.validFrom ? new Date(input.validFrom) : null;
  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (
    (requestedValidFrom !== null && Number.isNaN(requestedValidFrom.getTime()))
    || (validUntil !== null && Number.isNaN(validUntil.getTime()))
    || (
      requestedValidFrom !== null
      && validUntil !== null
      && validUntil <= requestedValidFrom
    )
  ) {
    throw new Error('ENTERPRISE_OWNERSHIP_EFFECTIVE_DATES_INVALID');
  }
  const evidenceRefs = [...new Set(
    (input.evidenceRefs ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  )].sort();
  const requestFingerprint = JSON.stringify({
    ownerLegalEntityId,
    subjectLegalEntityId,
    interestType,
    percentage,
    validFrom: requestedValidFrom?.toISOString() ?? null,
    validUntil: validUntil?.toISOString() ?? null,
    evidenceRefs,
  });

  const ownerNodeId = await resolveVerifiedLegalEntityNode(client, {
    tenantId: input.tenantId,
    enterpriseId: input.enterpriseId,
    legalEntityId: ownerLegalEntityId,
    actorSubjectId: input.requestedBySubjectId,
  });
  const subjectNodeId = await resolveVerifiedLegalEntityNode(client, {
    tenantId: input.tenantId,
    enterpriseId: input.enterpriseId,
    legalEntityId: subjectLegalEntityId,
    actorSubjectId: input.requestedBySubjectId,
  });

  const existing = await client.query<{
    enterprise_change_request_id: string;
    operation: string;
    proposed_payload: Record<string, unknown>;
  }>(
    `SELECT enterprise_change_request_id, operation, proposed_payload
       FROM platform.enterprise_change_requests
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, idempotencyKey],
  );
  const replay = existing.rows[0];
  if (replay) {
    const payload = replay.proposed_payload;
    const exact =
      replay.operation === 'CHANGE_OWNERSHIP'
      && payload.requestFingerprint === requestFingerprint;
    if (!exact) throw new Error('ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT');
    return {
      requestId: replay.enterprise_change_request_id,
      interest: mapInterest(
        await loadInterestByRequest(
          client,
          input.tenantId,
          replay.enterprise_change_request_id,
        ),
      ),
      idempotent: true,
    };
  }

  const requestId = randomUUID();
  const interestId = randomUUID();
  const validFrom = requestedValidFrom ?? new Date();

  await client.query(
    `INSERT INTO platform.enterprise_change_requests (
       enterprise_change_request_id,
       tenant_id,
       enterprise_id,
       operation,
       requesting_organization_id,
       approving_organization_id,
       target_legal_entity_id,
       status,
       proposed_payload,
       requested_by_subject_id,
       correlation_id,
       idempotency_key
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 'CHANGE_OWNERSHIP',
       $4::uuid, $4::uuid, $5::uuid, 'SUBMITTED',
       $6::jsonb, $7, $8, $9
     )`,
    [
      requestId,
      input.tenantId,
      input.enterpriseId,
      input.governingOrganizationId,
      subjectLegalEntityId,
      JSON.stringify({
        ownerLegalEntityId,
        subjectLegalEntityId,
        interestType,
        percentage,
        validFrom: validFrom.toISOString(),
        validUntil: validUntil?.toISOString() ?? null,
        evidenceRefs,
        requestFingerprint,
      }),
      input.requestedBySubjectId,
      input.correlationId,
      idempotencyKey,
    ],
  );

  await client.query(
    `INSERT INTO platform.entity_ownership_interests (
       interest_id,
       tenant_id,
       owner_node_id,
       subject_node_id,
       interest_type,
       percentage,
       valid_from,
       valid_until,
       status,
       provenance_source,
       evidence,
       created_by_subject_id,
       enterprise_change_request_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
       $6::numeric, $7::timestamptz, $8::timestamptz,
       'PENDING', 'USER', $9::jsonb, $10, $11::uuid
     )`,
    [
      interestId,
      input.tenantId,
      ownerNodeId,
      subjectNodeId,
      interestType,
      percentage,
      validFrom.toISOString(),
      validUntil?.toISOString() ?? null,
      JSON.stringify({ evidenceRefs }),
      input.requestedBySubjectId,
      requestId,
    ],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.ownership-interest',
      aggregateId: interestId,
      eventType: 'enterprise.ownership.change_requested',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.requestedBySubjectId,
      correlationId: input.correlationId,
      payload: {
        changeRequestId: requestId,
        ownerLegalEntityId,
        subjectLegalEntityId,
        interestType,
        percentage,
      },
    },
  });

  return {
    requestId,
    interest: mapInterest(
      await loadInterestByRequest(client, input.tenantId, requestId),
    ),
    idempotent: false,
  };
}

export async function decideEnterpriseOwnershipChange(
  client: EnterpriseOwnershipSqlClient,
  input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly approverOrganizationId: string;
    readonly decidedBySubjectId: string;
    readonly action: EnterpriseOwnershipDecision;
    readonly decisionReason?: string | null;
  },
): Promise<EnterpriseOwnershipInterest> {
  const request = await client.query<{
    enterprise_change_request_id: string;
    enterprise_id: string | null;
    operation: string;
    approving_organization_id: string;
    status: string;
    requested_by_subject_id: string;
    correlation_id: string;
  }>(
    `SELECT enterprise_change_request_id, enterprise_id, operation,
            approving_organization_id, status, requested_by_subject_id,
            correlation_id
       FROM platform.enterprise_change_requests
      WHERE tenant_id = $1::uuid
        AND enterprise_change_request_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.requestId],
  );
  const row = request.rows[0];
  if (!row) throw new Error('ENTERPRISE_CHANGE_REQUEST_NOT_FOUND');
  if (row.operation !== 'CHANGE_OWNERSHIP') {
    throw new Error('ENTERPRISE_CHANGE_REQUEST_OPERATION_UNSUPPORTED');
  }
  if (!['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(row.status)) {
    if (row.status === 'APPROVED' || row.status === 'REJECTED') {
      return mapInterest(
        await loadInterestByRequest(client, input.tenantId, input.requestId),
      );
    }
    throw new Error('ENTERPRISE_CHANGE_REQUEST_NOT_APPROVABLE');
  }
  if (row.approving_organization_id !== input.approverOrganizationId) {
    throw new Error('ENTERPRISE_APPROVER_SCOPE_MISMATCH');
  }
  if (row.requested_by_subject_id === input.decidedBySubjectId) {
    throw new Error('ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED');
  }

  const interest = await loadInterestByRequest(
    client,
    input.tenantId,
    input.requestId,
    true,
  );
  if (interest.status !== 'PENDING') {
    throw new Error('ENTERPRISE_OWNERSHIP_INTEREST_NOT_PENDING');
  }

  if (input.action === 'REJECT') {
    await client.query(
      `UPDATE platform.entity_ownership_interests
          SET status = 'REJECTED',
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND enterprise_change_request_id = $2::uuid`,
      [input.tenantId, input.requestId],
    );
    await client.query(
      `UPDATE platform.enterprise_change_requests
          SET status = 'REJECTED',
              decided_by_subject_id = $3,
              decided_at = now(),
              decision_reason = $4,
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND enterprise_change_request_id = $2::uuid`,
      [
        input.tenantId,
        input.requestId,
        input.decidedBySubjectId,
        input.decisionReason?.trim() || null,
      ],
    );

    await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'enterprise.ownership-interest',
        aggregateId: interest.interest_id,
        eventType: 'enterprise.ownership.rejected',
        eventVersion: 1,
        occurredAt: new Date(),
        actorSubjectId: input.decidedBySubjectId,
        correlationId: row.correlation_id,
        payload: { changeRequestId: input.requestId },
      },
    });

    return mapInterest(
      await loadInterestByRequest(client, input.tenantId, input.requestId),
    );
  }

  const currentApproved = await client.query<{
    readonly interest_id: string;
    readonly valid_from: Date | string;
  }>(
    `SELECT interest_id, valid_from
       FROM platform.entity_ownership_interests
      WHERE tenant_id = $1::uuid
        AND owner_node_id = (
          SELECT owner_node_id
            FROM platform.entity_ownership_interests
           WHERE tenant_id = $1::uuid
             AND enterprise_change_request_id = $2::uuid
        )
        AND subject_node_id = (
          SELECT subject_node_id
            FROM platform.entity_ownership_interests
           WHERE tenant_id = $1::uuid
             AND enterprise_change_request_id = $2::uuid
        )
        AND interest_type = (
          SELECT interest_type
            FROM platform.entity_ownership_interests
           WHERE tenant_id = $1::uuid
             AND enterprise_change_request_id = $2::uuid
        )
        AND status = 'APPROVED'
        AND valid_until IS NULL
        AND enterprise_change_request_id <> $2::uuid
      ORDER BY valid_from DESC, interest_id DESC
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.requestId],
  );
  const prior = currentApproved.rows[0];
  const nextValidFrom = new Date(interest.valid_from);
  if (prior) {
    const priorValidFrom = new Date(prior.valid_from);
    if (nextValidFrom <= priorValidFrom) {
      throw new Error('ENTERPRISE_OWNERSHIP_EFFECTIVE_ORDER_INVALID');
    }
    await client.query(
      `UPDATE platform.entity_ownership_interests
          SET status = 'SUPERSEDED',
              valid_until = $3::timestamptz,
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND interest_id = $2::uuid`,
      [input.tenantId, prior.interest_id, nextValidFrom.toISOString()],
    );
    await client.query(
      `UPDATE platform.entity_relationships
          SET valid_until = $5::timestamptz,
              updated_by_subject_id = $6,
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND source_entity_type = 'LEGAL_ENTITY'
          AND source_entity_id = $2
          AND relationship_key = $3
          AND target_entity_type = 'LEGAL_ENTITY'
          AND target_entity_id = $4
          AND status = 'ACTIVE'
          AND valid_until IS NULL`,
      [
        input.tenantId,
        interest.owner_entity_key,
        relationshipKeyForInterestType(interest.interest_type),
        interest.subject_entity_key,
        nextValidFrom.toISOString(),
        input.decidedBySubjectId,
      ],
    );
  }

  await client.query(
    `UPDATE platform.entity_ownership_interests
        SET status = 'APPROVED',
            approved_by_subject_id = $3,
            approved_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_change_request_id = $2::uuid`,
    [input.tenantId, input.requestId, input.decidedBySubjectId],
  );
  await client.query(
    `UPDATE platform.enterprise_change_requests
        SET status = 'APPROVED',
            decided_by_subject_id = $3,
            decided_at = now(),
            decision_reason = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_change_request_id = $2::uuid`,
    [
      input.tenantId,
      input.requestId,
      input.decidedBySubjectId,
      input.decisionReason?.trim() || null,
    ],
  );

  await publishGovernedEntityRelationship(client, {
    tenantId: input.tenantId,
    sourceEntityType: 'LEGAL_ENTITY',
    sourceEntityId: interest.owner_entity_key,
    relationshipKey: relationshipKeyForInterestType(interest.interest_type),
    targetEntityType: 'LEGAL_ENTITY',
    targetEntityId: interest.subject_entity_key,
    actorSubjectId: input.decidedBySubjectId,
    provenanceSource: 'SYSTEM',
    validFrom: interest.valid_from,
    validUntil: interest.valid_until,
    decisionReference: `enterprise-change-request:${input.requestId}`,
    attributes: {
      interestType: interest.interest_type,
      percentage:
        interest.percentage === null ? null : Number(interest.percentage),
      interestId: interest.interest_id,
      source: 'enterprise.ownership.approval',
    },
  });

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.ownership-interest',
      aggregateId: interest.interest_id,
      eventType: 'enterprise.ownership.approved',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.decidedBySubjectId,
      correlationId: row.correlation_id,
      payload: {
        changeRequestId: input.requestId,
        ownerLegalEntityId: interest.owner_entity_key,
        subjectLegalEntityId: interest.subject_entity_key,
        interestType: interest.interest_type,
        percentage:
          interest.percentage === null ? null : Number(interest.percentage),
      },
    },
  });

  return mapInterest(
    await loadInterestByRequest(client, input.tenantId, input.requestId),
  );
}

export async function listEnterpriseOwnershipInterests(
  client: EnterpriseOwnershipSqlClient,
  input: {
    readonly tenantId: string;
    readonly legalEntityIds: readonly string[];
  },
): Promise<readonly EnterpriseOwnershipInterest[]> {
  if (input.legalEntityIds.length === 0) return [];
  const result = await client.query<InterestRow>(
    `SELECT
       interest.interest_id,
       interest.enterprise_change_request_id,
       owner.entity_key AS owner_entity_key,
       subject.entity_key AS subject_entity_key,
       interest.interest_type,
       interest.percentage,
       interest.valid_from,
       interest.valid_until,
       interest.status,
       interest.created_by_subject_id,
       interest.approved_by_subject_id,
       interest.approved_at,
       interest.evidence
     FROM platform.entity_ownership_interests interest
     JOIN platform.entity_registry_nodes owner
       ON owner.node_id = interest.owner_node_id
      AND owner.tenant_id = interest.tenant_id
     JOIN platform.entity_registry_nodes subject
       ON subject.node_id = interest.subject_node_id
      AND subject.tenant_id = interest.tenant_id
     WHERE interest.tenant_id = $1::uuid
       AND owner.node_type = 'LEGAL_ENTITY'
       AND subject.node_type = 'LEGAL_ENTITY'
       AND owner.entity_key = ANY($2::text[])
       AND subject.entity_key = ANY($2::text[])
     ORDER BY
       interest.status = 'APPROVED' DESC,
       interest.valid_from DESC,
       interest.interest_id DESC`,
    [input.tenantId, input.legalEntityIds],
  );
  return result.rows.map(mapInterest);
}
