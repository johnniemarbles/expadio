import { randomUUID } from 'node:crypto';
import { appendDomainEventWithOutbox } from './domain-events.ts';

export interface OrganizationSetupSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface OrganizationSetupSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<OrganizationSetupSqlResult<Row>>;
}

export type OrganizationSetupPlanState =
  | 'PROVISIONING'
  | 'CONFIGURING'
  | 'READY_FOR_ACTIVATION'
  | 'ACTIVATED'
  | 'CANCELLED';

export type OrganizationSetupRequirementStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SATISFIED'
  | 'WAIVED'
  | 'BLOCKED';

export type OrganizationSetupRequirementCategory =
  | 'ORGANIZATION'
  | 'LEGAL'
  | 'GOVERNANCE'
  | 'ACCESS'
  | 'FINANCE'
  | 'COMPLIANCE'
  | 'MODULE'
  | 'VERTICAL'
  | 'OPERATIONS'
  | 'DATA'
  | 'COMMUNICATION'
  | 'CUSTOM';

export type OrganizationSetupRequirementSource =
  | 'CORE'
  | 'MODULE'
  | 'VERTICAL'
  | 'TENANT'
  | 'PARENT_POLICY'
  | 'CUSTOM';

export type OrganizationSetupSatisfactionMode =
  | 'MANUAL'
  | 'EVIDENCE'
  | 'AUTOMATED'
  | 'APPROVAL';

export type OrganizationSetupParticipantRole =
  | 'OWNER'
  | 'CONTRIBUTOR'
  | 'REVIEWER';

export interface OrganizationSetupParticipant {
  readonly participantId: string;
  readonly subjectId: string;
  readonly issuer: string | null;
  readonly role: OrganizationSetupParticipantRole;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface OrganizationSetupPlan {
  readonly setupPlanId: string;
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly organizationId: string;
  readonly provisioningChangeRequestId: string | null;
  readonly primaryAdministratorSubjectId: string | null;
  readonly primaryAdministratorIssuer: string | null;
  readonly version: number;
  readonly state: OrganizationSetupPlanState;
  readonly totalRequirements: number;
  readonly completedRequirements: number;
  readonly blockingOpenRequirements: number;
  readonly completionPercent: number;
  readonly startedBySubjectId: string;
  readonly startedAt: string;
  readonly readyAt: string | null;
  readonly activatedAt: string | null;
  readonly updatedAt: string;
}

export interface OrganizationSetupRequirement {
  readonly setupRequirementId: string;
  readonly tenantId: string;
  readonly setupPlanId: string;
  readonly requirementKey: string;
  readonly category: OrganizationSetupRequirementCategory;
  readonly sourceKind: OrganizationSetupRequirementSource;
  readonly sourceKey: string | null;
  readonly title: string;
  readonly description: string;
  readonly blocking: boolean;
  readonly satisfactionMode: OrganizationSetupSatisfactionMode;
  readonly status: OrganizationSetupRequirementStatus;
  readonly ownerSubjectId: string | null;
  readonly dueAt: string | null;
  readonly satisfiedBySubjectId: string | null;
  readonly satisfiedAt: string | null;
  readonly waivedBySubjectId: string | null;
  readonly waivedAt: string | null;
  readonly waiverReason: string | null;
  readonly evidenceRefs: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
}

interface SetupPlanRow {
  readonly setup_plan_id: string;
  readonly tenant_id: string;
  readonly enterprise_id: string;
  readonly organization_id: string;
  readonly provisioning_change_request_id: string | null;
  readonly primary_administrator_subject_id: string | null;
  readonly primary_administrator_issuer: string | null;
  readonly version: number;
  readonly state: OrganizationSetupPlanState;
  readonly total_requirements: number;
  readonly completed_requirements: number;
  readonly blocking_open_requirements: number;
  readonly completion_percent: string | number;
  readonly started_by_subject_id: string;
  readonly started_at: Date | string;
  readonly ready_at: Date | string | null;
  readonly activated_at: Date | string | null;
  readonly updated_at: Date | string;
}

interface SetupRequirementRow {
  readonly setup_requirement_id: string;
  readonly tenant_id: string;
  readonly setup_plan_id: string;
  readonly requirement_key: string;
  readonly category: OrganizationSetupRequirementCategory;
  readonly source_kind: OrganizationSetupRequirementSource;
  readonly source_key: string | null;
  readonly title: string;
  readonly description: string;
  readonly blocking: boolean;
  readonly satisfaction_mode: OrganizationSetupSatisfactionMode;
  readonly status: OrganizationSetupRequirementStatus;
  readonly owner_subject_id: string | null;
  readonly due_at: Date | string | null;
  readonly satisfied_by_subject_id: string | null;
  readonly satisfied_at: Date | string | null;
  readonly waived_by_subject_id: string | null;
  readonly waived_at: Date | string | null;
  readonly waiver_reason: string | null;
  readonly evidence_refs: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly sort_order: number;
}

interface SetupEventRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly setup_plan_id: string;
  readonly setup_requirement_id: string | null;
  readonly from_state: string | null;
  readonly to_state: string | null;
  readonly actor_subject_id: string;
  readonly reason: string | null;
  readonly evidence_refs: readonly string[];
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly payload: Record<string, unknown>;
}

const PLAN_SELECT = `setup_plan_id, tenant_id, enterprise_id, organization_id,
  provisioning_change_request_id, primary_administrator_subject_id,
  primary_administrator_issuer, version, state, total_requirements,
  completed_requirements, blocking_open_requirements, completion_percent,
  started_by_subject_id, started_at, ready_at, activated_at, updated_at`;

const REQUIREMENT_SELECT = `setup_requirement_id, tenant_id, setup_plan_id,
  requirement_key, category, source_kind, source_key, title, description,
  blocking, satisfaction_mode, status, owner_subject_id, due_at, satisfied_by_subject_id,
  satisfied_at, waived_by_subject_id, waived_at, waiver_reason, evidence_refs,
  metadata, sort_order`;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function mapPlan(row: SetupPlanRow): OrganizationSetupPlan {
  return {
    setupPlanId: row.setup_plan_id,
    tenantId: row.tenant_id,
    enterpriseId: row.enterprise_id,
    organizationId: row.organization_id,
    provisioningChangeRequestId: row.provisioning_change_request_id,
    primaryAdministratorSubjectId: row.primary_administrator_subject_id,
    primaryAdministratorIssuer: row.primary_administrator_issuer,
    version: Number(row.version),
    state: row.state,
    totalRequirements: Number(row.total_requirements),
    completedRequirements: Number(row.completed_requirements),
    blockingOpenRequirements: Number(row.blocking_open_requirements),
    completionPercent: Number(row.completion_percent),
    startedBySubjectId: row.started_by_subject_id,
    startedAt: iso(row.started_at),
    readyAt: nullableIso(row.ready_at),
    activatedAt: nullableIso(row.activated_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapRequirement(row: SetupRequirementRow): OrganizationSetupRequirement {
  return {
    setupRequirementId: row.setup_requirement_id,
    tenantId: row.tenant_id,
    setupPlanId: row.setup_plan_id,
    requirementKey: row.requirement_key,
    category: row.category,
    sourceKind: row.source_kind,
    sourceKey: row.source_key,
    title: row.title,
    description: row.description,
    blocking: row.blocking,
    satisfactionMode: row.satisfaction_mode,
    status: row.status,
    ownerSubjectId: row.owner_subject_id,
    dueAt: nullableIso(row.due_at),
    satisfiedBySubjectId: row.satisfied_by_subject_id,
    satisfiedAt: nullableIso(row.satisfied_at),
    waivedBySubjectId: row.waived_by_subject_id,
    waivedAt: nullableIso(row.waived_at),
    waiverReason: row.waiver_reason,
    evidenceRefs: [...row.evidence_refs],
    metadata: row.metadata,
    sortOrder: Number(row.sort_order),
  };
}

async function appendSetupEvent(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly setupRequirementId?: string | null;
    readonly eventType: string;
    readonly fromState?: string | null;
    readonly toState?: string | null;
    readonly actorSubjectId: string;
    readonly reason?: string | null;
    readonly evidenceRefs?: readonly string[];
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  },
): Promise<{ readonly replay: boolean; readonly eventId: string }> {
  const eventId = randomUUID();
  const inserted = await client.query<{ readonly event_id: string }>(
    `INSERT INTO platform.organization_setup_events (
       event_id, tenant_id, setup_plan_id, setup_requirement_id, event_type,
       from_state, to_state, actor_subject_id, reason, evidence_refs,
       correlation_id, idempotency_key, payload
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
       $6, $7, $8, $9, $10::text[], $11, $12, $13::jsonb
     )
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING event_id`,
    [
      eventId,
      input.tenantId,
      input.setupPlanId,
      input.setupRequirementId ?? null,
      input.eventType,
      input.fromState ?? null,
      input.toState ?? null,
      input.actorSubjectId,
      input.reason ?? null,
      [...(input.evidenceRefs ?? [])],
      input.correlationId,
      input.idempotencyKey,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  if (inserted.rows[0]) return { replay: false, eventId };

  const existing = await client.query<SetupEventRow>(
    `SELECT event_id, event_type, setup_plan_id, setup_requirement_id,
            from_state, to_state, actor_subject_id, reason, evidence_refs,
            correlation_id, idempotency_key, payload
       FROM platform.organization_setup_events
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, input.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('ORGANIZATION_SETUP_EVENT_CREATE_FAILED');

  const same =
    row.event_type === input.eventType
    && row.setup_plan_id === input.setupPlanId
    && row.setup_requirement_id === (input.setupRequirementId ?? null)
    && row.from_state === (input.fromState ?? null)
    && row.to_state === (input.toState ?? null)
    && row.actor_subject_id === input.actorSubjectId
    && row.reason === (input.reason ?? null)
    && JSON.stringify([...row.evidence_refs]) === JSON.stringify([...(input.evidenceRefs ?? [])])
    && JSON.stringify(row.payload) === JSON.stringify(input.payload ?? {});

  if (!same) throw new Error('ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT');
  return { replay: true, eventId: row.event_id };
}

async function appendSetupDomainEvent(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'organization.setup',
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { ...input.payload },
      metadata: { source: 'enterprise.organization-setup' },
    },
  });
}

export async function findOrganizationSetupPlan(
  client: OrganizationSetupSqlClient,
  input: { readonly tenantId: string; readonly organizationId: string },
): Promise<OrganizationSetupPlan | null> {
  const result = await client.query<SetupPlanRow>(
    `SELECT ${PLAN_SELECT}
       FROM platform.organization_setup_plans
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.organizationId],
  );
  const row = result.rows[0];
  return row ? mapPlan(row) : null;
}

export async function listOrganizationSetupRequirements(
  client: OrganizationSetupSqlClient,
  input: { readonly tenantId: string; readonly setupPlanId: string },
): Promise<readonly OrganizationSetupRequirement[]> {
  const result = await client.query<SetupRequirementRow>(
    `SELECT ${REQUIREMENT_SELECT}
       FROM platform.organization_setup_requirements
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
      ORDER BY sort_order ASC, requirement_key ASC`,
    [input.tenantId, input.setupPlanId],
  );
  return result.rows.map(mapRequirement);
}

export async function registerOrganizationSetupRequirement(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly requirementKey: string;
    readonly category: OrganizationSetupRequirementCategory;
    readonly sourceKind: OrganizationSetupRequirementSource;
    readonly sourceKey?: string | null;
    readonly title: string;
    readonly description?: string;
    readonly blocking?: boolean;
    readonly satisfactionMode?: OrganizationSetupSatisfactionMode;
    readonly ownerSubjectId?: string | null;
    readonly dueAt?: string | null;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly sortOrder?: number;
    readonly createdBySubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly requirement: OrganizationSetupRequirement; readonly idempotent: boolean }> {
  const requirementKey = input.requirementKey.trim();
  const title = input.title.trim();
  if (!requirementKey) throw new Error('ORGANIZATION_SETUP_REQUIREMENT_KEY_REQUIRED');
  if (!title) throw new Error('ORGANIZATION_SETUP_REQUIREMENT_TITLE_REQUIRED');

  const existing = await client.query<SetupRequirementRow>(
    `SELECT ${REQUIREMENT_SELECT}
       FROM platform.organization_setup_requirements
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
        AND requirement_key = $3
      LIMIT 1`,
    [input.tenantId, input.setupPlanId, requirementKey],
  );
  const prior = existing.rows[0];
  if (prior) {
    const exact =
      prior.category === input.category
      && prior.source_kind === input.sourceKind
      && prior.source_key === (input.sourceKey ?? null)
      && prior.title === title
      && prior.description === (input.description ?? '')
      && prior.blocking === (input.blocking ?? true)
      && prior.satisfaction_mode === (input.satisfactionMode ?? 'MANUAL')
      && prior.owner_subject_id === (input.ownerSubjectId ?? null)
      && nullableIso(prior.due_at) === (
        input.dueAt == null ? null : iso(input.dueAt)
      )
      && JSON.stringify(prior.metadata) === JSON.stringify(input.metadata ?? {})
      && Number(prior.sort_order) === (input.sortOrder ?? 0);
    if (!exact) throw new Error('ORGANIZATION_SETUP_REQUIREMENT_CONFLICT');
    return { requirement: mapRequirement(prior), idempotent: true };
  }

  const requirementId = randomUUID();
  const inserted = await client.query<SetupRequirementRow>(
    `INSERT INTO platform.organization_setup_requirements (
       setup_requirement_id, tenant_id, setup_plan_id, requirement_key,
       category, source_kind, source_key, title, description, blocking,
       satisfaction_mode, owner_subject_id, due_at, metadata, sort_order,
       created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13::timestamptz, $14::jsonb, $15, $16
     )
     RETURNING ${REQUIREMENT_SELECT}`,
    [
      requirementId,
      input.tenantId,
      input.setupPlanId,
      requirementKey,
      input.category,
      input.sourceKind,
      input.sourceKey ?? null,
      title,
      input.description ?? '',
      input.blocking ?? true,
      input.satisfactionMode ?? 'MANUAL',
      input.ownerSubjectId ?? null,
      input.dueAt ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.sortOrder ?? 0,
      input.createdBySubjectId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('ORGANIZATION_SETUP_REQUIREMENT_CREATE_FAILED');

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    setupRequirementId: requirementId,
    eventType: 'REQUIREMENT_ADDED',
    actorSubjectId: input.createdBySubjectId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      requirementKey,
      category: input.category,
      sourceKind: input.sourceKind,
      sourceKey: input.sourceKey ?? null,
      blocking: input.blocking ?? true,
      satisfactionMode: input.satisfactionMode ?? 'MANUAL',
    },
  });
  if (!setupEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.setupPlanId,
      eventType: 'organization.setup.requirement_added',
      actorSubjectId: input.createdBySubjectId,
      correlationId: input.correlationId,
      payload: {
        requirementId,
        requirementKey,
        category: input.category,
        sourceKind: input.sourceKind,
        sourceKey: input.sourceKey ?? null,
        blocking: input.blocking ?? true,
        satisfactionMode: input.satisfactionMode ?? 'MANUAL',
      },
    });
  }

  return { requirement: mapRequirement(row), idempotent: false };
}

export async function addOrganizationSetupDependency(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly requirementId: string;
    readonly dependsOnRequirementId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly idempotent: boolean }> {
  const result = await client.query(
    `INSERT INTO platform.organization_setup_requirement_dependencies (
       tenant_id, setup_plan_id, setup_requirement_id, depends_on_requirement_id,
       created_by_subject_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)
     ON CONFLICT DO NOTHING`,
    [
      input.tenantId,
      input.setupPlanId,
      input.requirementId,
      input.dependsOnRequirementId,
      input.actorSubjectId,
    ],
  );
  if (result.rowCount === 0) return { idempotent: true };

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    setupRequirementId: input.requirementId,
    eventType: 'REQUIREMENT_DEPENDENCY_ADDED',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      requirementId: input.requirementId,
      dependsOnRequirementId: input.dependsOnRequirementId,
    },
  });
  if (!setupEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.setupPlanId,
      eventType: 'organization.setup.requirement_dependency_added',
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        requirementId: input.requirementId,
        dependsOnRequirementId: input.dependsOnRequirementId,
      },
    });
  }

  return { idempotent: false };
}

export async function addOrganizationSetupParticipant(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly subjectId: string;
    readonly issuer?: string | null;
    readonly role: OrganizationSetupParticipantRole;
    readonly validUntil?: string | null;
    readonly createdBySubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly participantId: string; readonly idempotent: boolean }> {
  const subjectId = input.subjectId.trim();
  if (!subjectId) throw new Error('ORGANIZATION_SETUP_PARTICIPANT_SUBJECT_REQUIRED');

  const existing = await client.query<{
    readonly setup_participant_id: string;
    readonly role: OrganizationSetupParticipantRole;
    readonly valid_until: Date | string | null;
  }>(
    `SELECT setup_participant_id, role, valid_until
       FROM platform.organization_setup_participants
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
        AND subject_id = $3
        AND issuer IS NOT DISTINCT FROM $4
        AND status = 'ACTIVE'
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.setupPlanId, subjectId, input.issuer ?? null],
  );
  const prior = existing.rows[0];
  if (prior) {
    const priorValidUntil = prior.valid_until === null ? null : iso(prior.valid_until);
    const requestedValidUntil =
      input.validUntil == null ? null : iso(input.validUntil);

    if (prior.role === input.role && priorValidUntil === requestedValidUntil) {
      return { participantId: prior.setup_participant_id, idempotent: true };
    }

    await client.query(
      `UPDATE platform.organization_setup_participants
          SET role = $4, valid_until = $5::timestamptz, updated_at = now()
        WHERE tenant_id = $1::uuid
          AND setup_plan_id = $2::uuid
          AND setup_participant_id = $3::uuid`,
      [
        input.tenantId,
        input.setupPlanId,
        prior.setup_participant_id,
        input.role,
        input.validUntil ?? null,
      ],
    );

    const participantEvent = await appendSetupEvent(client, {
      tenantId: input.tenantId,
      setupPlanId: input.setupPlanId,
      eventType: 'PARTICIPANT_ACCESS_CHANGED',
      fromState: prior.role,
      toState: input.role,
      actorSubjectId: input.createdBySubjectId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        participantId: prior.setup_participant_id,
        subjectId,
        fromRole: prior.role,
        toRole: input.role,
        fromValidUntil: priorValidUntil,
        toValidUntil: requestedValidUntil,
      },
    });
    if (!participantEvent.replay) {
      await appendSetupDomainEvent(client, {
        tenantId: input.tenantId,
        aggregateId: input.setupPlanId,
        eventType: 'organization.setup.participant_access_changed',
        actorSubjectId: input.createdBySubjectId,
        correlationId: input.correlationId,
        payload: {
          participantId: prior.setup_participant_id,
          subjectId,
          fromRole: prior.role,
          toRole: input.role,
          fromValidUntil: priorValidUntil,
          toValidUntil: requestedValidUntil,
        },
      });
    }
    return { participantId: prior.setup_participant_id, idempotent: false };
  }

  const participantId = randomUUID();
  await client.query(
    `INSERT INTO platform.organization_setup_participants (
       setup_participant_id, tenant_id, setup_plan_id, subject_id, issuer,
       role, status, valid_until, created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'ACTIVE', $7::timestamptz, $8
     )`,
    [
      participantId,
      input.tenantId,
      input.setupPlanId,
      subjectId,
      input.issuer ?? null,
      input.role,
      input.validUntil ?? null,
      input.createdBySubjectId,
    ],
  );

  const participantEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    eventType: 'PARTICIPANT_ADDED',
    actorSubjectId: input.createdBySubjectId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      participantId,
      subjectId,
      role: input.role,
      validUntil: input.validUntil ?? null,
    },
  });
  if (!participantEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.setupPlanId,
      eventType: 'organization.setup.participant_added',
      actorSubjectId: input.createdBySubjectId,
      correlationId: input.correlationId,
      payload: {
        participantId,
        subjectId,
        role: input.role,
        validUntil: input.validUntil ?? null,
      },
    });
  }

  return { participantId, idempotent: false };
}

export async function listOrganizationSetupParticipants(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
  },
): Promise<readonly OrganizationSetupParticipant[]> {
  const result = await client.query<{
    readonly setup_participant_id: string;
    readonly subject_id: string;
    readonly issuer: string | null;
    readonly role: OrganizationSetupParticipantRole;
    readonly status: 'ACTIVE' | 'REVOKED';
    readonly valid_from: Date | string;
    readonly valid_until: Date | string | null;
  }>(
    `SELECT
       setup_participant_id,
       subject_id,
       issuer,
       role,
       status,
       valid_from,
       valid_until
     FROM platform.organization_setup_participants
     WHERE tenant_id = $1::uuid
       AND setup_plan_id = $2::uuid
     ORDER BY
       CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
       CASE role WHEN 'OWNER' THEN 0 WHEN 'REVIEWER' THEN 1 ELSE 2 END,
       created_at ASC,
       setup_participant_id ASC`,
    [input.tenantId, input.setupPlanId],
  );
  return result.rows.map((row) => ({
    participantId: row.setup_participant_id,
    subjectId: row.subject_id,
    issuer: row.issuer,
    role: row.role,
    status: row.status,
    validFrom: iso(row.valid_from),
    validUntil: nullableIso(row.valid_until),
  }));
}

export async function designateOrganizationSetupPrimaryAdministrator(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly subjectId: string;
    readonly issuer: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly plan: OrganizationSetupPlan;
  readonly idempotent: boolean;
}> {
  const plan = await loadPlanById(client, input.tenantId, input.setupPlanId, true);
  if (plan.state === 'ACTIVATED' || plan.state === 'CANCELLED') {
    throw new Error('ORGANIZATION_SETUP_PLAN_CLOSED');
  }

  const subjectId = input.subjectId.trim();
  const issuer = input.issuer.trim();
  if (!subjectId || !issuer) {
    throw new Error('ORGANIZATION_SETUP_PRIMARY_ADMIN_REQUIRED');
  }

  const participant = await client.query<{ readonly setup_participant_id: string }>(
    `SELECT setup_participant_id
       FROM platform.organization_setup_participants
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
        AND subject_id = $3
        AND issuer IS NOT DISTINCT FROM $4
        AND role = 'OWNER'
        AND status = 'ACTIVE'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.setupPlanId, subjectId, issuer],
  );
  if (!participant.rows[0]) {
    throw new Error('ORGANIZATION_SETUP_PRIMARY_ADMIN_OWNER_REQUIRED');
  }

  if (
    plan.primaryAdministratorSubjectId === subjectId
    && plan.primaryAdministratorIssuer === issuer
  ) {
    return { plan, idempotent: true };
  }

  const existingEvent = await client.query<SetupEventRow>(
    `SELECT event_id, event_type, setup_plan_id, setup_requirement_id,
            from_state, to_state, actor_subject_id, reason, evidence_refs,
            correlation_id, idempotency_key, payload
       FROM platform.organization_setup_events
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, input.idempotencyKey],
  );
  if (existingEvent.rows[0]) {
    throw new Error('ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT');
  }

  await client.query(
    `UPDATE platform.organization_setup_plans
        SET primary_administrator_subject_id = $3,
            primary_administrator_issuer = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid`,
    [input.tenantId, input.setupPlanId, subjectId, issuer],
  );

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    eventType: 'PRIMARY_ADMINISTRATOR_DESIGNATED',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      previousSubjectId: plan.primaryAdministratorSubjectId,
      previousIssuer: plan.primaryAdministratorIssuer,
      subjectId,
      issuer,
      participantId: participant.rows[0].setup_participant_id,
    },
  });
  if (!setupEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.setupPlanId,
      eventType: 'organization.setup.primary_administrator_designated',
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        previousSubjectId: plan.primaryAdministratorSubjectId,
        previousIssuer: plan.primaryAdministratorIssuer,
        subjectId,
        issuer,
        participantId: participant.rows[0].setup_participant_id,
      },
    });
  }

  const evaluated = await evaluateOrganizationSetupAutomatedRequirements(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    correlationId: input.correlationId,
  });
  return { plan: evaluated.plan, idempotent: false };
}

export async function startOrganizationSetup(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly organizationId: string;
    readonly provisioningChangeRequestId?: string | null;
    readonly startedBySubjectId: string;
    readonly issuer?: string | null;
    readonly correlationId: string;
  },
): Promise<{ readonly plan: OrganizationSetupPlan; readonly idempotent: boolean }> {
  const existing = await findOrganizationSetupPlan(client, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  });
  if (existing) return { plan: existing, idempotent: true };

  const organization = await client.query<{
    readonly enterprise_id: string;
    readonly status: string;
  }>(
    `SELECT enterprise_id, status
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.organizationId],
  );
  const org = organization.rows[0];
  if (!org) throw new Error('ORGANIZATION_SETUP_ORGANIZATION_NOT_FOUND');
  if (org.enterprise_id !== input.enterpriseId) {
    throw new Error('ORGANIZATION_SETUP_ENTERPRISE_MISMATCH');
  }
  if (!['PROVISIONING', 'CONFIGURING', 'READY_FOR_ACTIVATION'].includes(org.status)) {
    throw new Error('ORGANIZATION_SETUP_ORGANIZATION_STATE_INVALID');
  }

  const setupPlanId = randomUUID();
  const created = await client.query<SetupPlanRow>(
    `INSERT INTO platform.organization_setup_plans (
       setup_plan_id, tenant_id, enterprise_id, organization_id,
       provisioning_change_request_id, state, started_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       'PROVISIONING', $6
     )
     RETURNING ${PLAN_SELECT}`,
    [
      setupPlanId,
      input.tenantId,
      input.enterpriseId,
      input.organizationId,
      input.provisioningChangeRequestId ?? null,
      input.startedBySubjectId,
    ],
  );
  if (!created.rows[0]) throw new Error('ORGANIZATION_SETUP_PLAN_CREATE_FAILED');

  await addOrganizationSetupParticipant(client, {
    tenantId: input.tenantId,
    setupPlanId,
    subjectId: input.startedBySubjectId,
    issuer: input.issuer ?? null,
    role: 'OWNER',
    createdBySubjectId: input.startedBySubjectId,
    correlationId: input.correlationId,
    idempotencyKey: `setup:${setupPlanId}:owner:${input.startedBySubjectId}`,
  });

  const coreRequirements = [
    {
      requirementKey: 'core.organization-profile',
      category: 'ORGANIZATION' as const,
      title: 'Complete organization profile',
      description: 'Confirm operating name, organization kind, hierarchy position, and responsible parent.',
      satisfactionMode: 'AUTOMATED' as const,
      sortOrder: 10,
    },
    {
      requirementKey: 'core.operating-entity',
      category: 'LEGAL' as const,
      title: 'Assign operating legal entity',
      description: 'Bind a verified legal entity that operates this organization.',
      satisfactionMode: 'AUTOMATED' as const,
      sortOrder: 20,
    },
    {
      requirementKey: 'core.primary-administrator',
      category: 'ACCESS' as const,
      title: 'Assign primary setup administrator',
      description: 'Establish an accountable setup owner before business-runtime activation.',
      satisfactionMode: 'AUTOMATED' as const,
      sortOrder: 30,
    },
  ];

  for (const requirement of coreRequirements) {
    await registerOrganizationSetupRequirement(client, {
      tenantId: input.tenantId,
      setupPlanId,
      requirementKey: requirement.requirementKey,
      category: requirement.category,
      sourceKind: 'CORE',
      sourceKey: 'enterprise.organization-setup.v1',
      title: requirement.title,
      description: requirement.description,
      blocking: true,
      satisfactionMode: requirement.satisfactionMode,
      sortOrder: requirement.sortOrder,
      createdBySubjectId: input.startedBySubjectId,
      correlationId: input.correlationId,
      idempotencyKey: `setup:${setupPlanId}:requirement:${requirement.requirementKey}`,
    });
  }

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId,
    eventType: 'SETUP_STARTED',
    fromState: 'PROVISIONING',
    toState: 'CONFIGURING',
    actorSubjectId: input.startedBySubjectId,
    correlationId: input.correlationId,
    idempotencyKey: `setup:${setupPlanId}:started`,
    payload: {
      organizationId: input.organizationId,
      enterpriseId: input.enterpriseId,
      provisioningChangeRequestId: input.provisioningChangeRequestId ?? null,
    },
  });

  if (!setupEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: setupPlanId,
      eventType: 'organization.setup.started',
      actorSubjectId: input.startedBySubjectId,
      correlationId: input.correlationId,
      payload: {
        organizationId: input.organizationId,
        enterpriseId: input.enterpriseId,
      },
    });
  }

  const evaluated = await evaluateOrganizationSetupAutomatedRequirements(client, {
    tenantId: input.tenantId,
    setupPlanId,
    correlationId: input.correlationId,
  });
  return { plan: evaluated.plan, idempotent: false };
}

export async function changeOrganizationSetupRequirement(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly requirementId: string;
    readonly action: 'START' | 'SATISFY' | 'WAIVE' | 'BLOCK' | 'REOPEN';
    readonly actorSubjectId: string;
    readonly reason?: string | null;
    readonly evidenceRefs?: readonly string[];
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly systemEvaluation?: boolean;
  },
): Promise<{
  readonly requirement: OrganizationSetupRequirement;
  readonly plan: OrganizationSetupPlan;
  readonly idempotent: boolean;
}> {
  const replay = await client.query<SetupEventRow>(
    `SELECT event_id, event_type, setup_plan_id, setup_requirement_id,
            from_state, to_state, actor_subject_id, reason, evidence_refs,
            correlation_id, idempotency_key, payload
       FROM platform.organization_setup_events
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, input.idempotencyKey],
  );
  const replayRow = replay.rows[0];
  if (replayRow) {
    if (
      replayRow.event_type !== 'REQUIREMENT_STATUS_CHANGED'
      || replayRow.setup_plan_id !== input.setupPlanId
      || replayRow.setup_requirement_id !== input.requirementId
      || replayRow.actor_subject_id !== input.actorSubjectId
      || replayRow.reason !== (input.reason?.trim() || null)
      || JSON.stringify([...replayRow.evidence_refs])
        !== JSON.stringify([...(input.evidenceRefs ?? [])])
      || replayRow.payload.action !== input.action
    ) {
      throw new Error('ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT');
    }
    const requirement = await loadRequirement(client, input);
    const plan = await loadPlanById(client, input.tenantId, input.setupPlanId);
    return { requirement, plan, idempotent: true };
  }

  const planBefore = await loadPlanById(client, input.tenantId, input.setupPlanId, true);
  if (['ACTIVATED', 'CANCELLED'].includes(planBefore.state)) {
    throw new Error('ORGANIZATION_SETUP_PLAN_CLOSED');
  }

  const requirement = await loadRequirement(client, input, true);
  if (requirement.satisfactionMode === 'AUTOMATED' && !input.systemEvaluation) {
    throw new Error('ORGANIZATION_SETUP_AUTOMATED_REQUIREMENT');
  }
  if (
    requirement.satisfactionMode === 'EVIDENCE'
    && input.action === 'SATISFY'
    && (input.evidenceRefs?.length ?? 0) === 0
  ) {
    throw new Error('ORGANIZATION_SETUP_EVIDENCE_REQUIRED');
  }
  const fromStatus = requirement.status;
  const toStatus = transitionRequirement(fromStatus, input.action);

  if (input.action === 'SATISFY') {
    const unmet = await client.query<{ readonly count: string | number }>(
      `SELECT count(*) AS count
         FROM platform.organization_setup_requirement_dependencies dependency
         JOIN platform.organization_setup_requirements required
           ON required.tenant_id = dependency.tenant_id
          AND required.setup_requirement_id = dependency.depends_on_requirement_id
        WHERE dependency.tenant_id = $1::uuid
          AND dependency.setup_plan_id = $2::uuid
          AND dependency.setup_requirement_id = $3::uuid
          AND required.status NOT IN ('SATISFIED','WAIVED')`,
      [input.tenantId, input.setupPlanId, input.requirementId],
    );
    if (Number(unmet.rows[0]?.count ?? 0) > 0) {
      throw new Error('ORGANIZATION_SETUP_DEPENDENCIES_INCOMPLETE');
    }
  }

  const reason = input.reason?.trim() || null;
  if (input.action === 'WAIVE' && !reason) {
    throw new Error('ORGANIZATION_SETUP_WAIVER_REASON_REQUIRED');
  }
  if ((input.action === 'BLOCK' || input.action === 'REOPEN') && !reason) {
    throw new Error('ORGANIZATION_SETUP_CHANGE_REASON_REQUIRED');
  }

  const now = new Date().toISOString();
  const updated = await client.query<SetupRequirementRow>(
    `UPDATE platform.organization_setup_requirements
        SET status = $4,
            satisfied_by_subject_id = CASE WHEN $4 = 'SATISFIED' THEN $5 ELSE NULL END,
            satisfied_at = CASE WHEN $4 = 'SATISFIED' THEN $6::timestamptz ELSE NULL END,
            waived_by_subject_id = CASE WHEN $4 = 'WAIVED' THEN $5 ELSE NULL END,
            waived_at = CASE WHEN $4 = 'WAIVED' THEN $6::timestamptz ELSE NULL END,
            waiver_reason = CASE WHEN $4 = 'WAIVED' THEN $7 ELSE NULL END,
            evidence_refs = $8::text[],
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
        AND setup_requirement_id = $3::uuid
      RETURNING ${REQUIREMENT_SELECT}`,
    [
      input.tenantId,
      input.setupPlanId,
      input.requirementId,
      toStatus,
      input.actorSubjectId,
      now,
      reason,
      [...(input.evidenceRefs ?? [])],
    ],
  );
  const updatedRow = updated.rows[0];
  if (!updatedRow) throw new Error('ORGANIZATION_SETUP_REQUIREMENT_UPDATE_FAILED');

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    setupRequirementId: input.requirementId,
    eventType: 'REQUIREMENT_STATUS_CHANGED',
    fromState: fromStatus,
    toState: toStatus,
    actorSubjectId: input.actorSubjectId,
    reason,
    evidenceRefs: input.evidenceRefs ?? [],
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: { action: input.action, requirementKey: requirement.requirementKey },
  });

  if (!setupEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.setupPlanId,
      eventType: 'organization.setup.requirement_changed',
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        requirementId: input.requirementId,
        requirementKey: requirement.requirementKey,
        fromStatus,
        toStatus,
        action: input.action,
      },
    });
  }

  const plan = await loadPlanById(client, input.tenantId, input.setupPlanId);
  return { requirement: mapRequirement(updatedRow), plan, idempotent: false };
}

function transitionRequirement(
  from: OrganizationSetupRequirementStatus,
  action: 'START' | 'SATISFY' | 'WAIVE' | 'BLOCK' | 'REOPEN',
): OrganizationSetupRequirementStatus {
  switch (action) {
    case 'START':
      if (from !== 'PENDING') throw new Error('ORGANIZATION_SETUP_REQUIREMENT_TRANSITION_INVALID');
      return 'IN_PROGRESS';
    case 'SATISFY':
      if (!['PENDING', 'IN_PROGRESS', 'BLOCKED'].includes(from)) {
        throw new Error('ORGANIZATION_SETUP_REQUIREMENT_TRANSITION_INVALID');
      }
      return 'SATISFIED';
    case 'WAIVE':
      if (!['PENDING', 'IN_PROGRESS', 'BLOCKED'].includes(from)) {
        throw new Error('ORGANIZATION_SETUP_REQUIREMENT_TRANSITION_INVALID');
      }
      return 'WAIVED';
    case 'BLOCK':
      if (!['PENDING', 'IN_PROGRESS'].includes(from)) {
        throw new Error('ORGANIZATION_SETUP_REQUIREMENT_TRANSITION_INVALID');
      }
      return 'BLOCKED';
    case 'REOPEN':
      if (!['SATISFIED', 'WAIVED', 'BLOCKED'].includes(from)) {
        throw new Error('ORGANIZATION_SETUP_REQUIREMENT_TRANSITION_INVALID');
      }
      return 'PENDING';
  }
}

async function loadRequirement(
  client: OrganizationSetupSqlClient,
  input: { readonly tenantId: string; readonly setupPlanId: string; readonly requirementId: string },
  forUpdate = false,
): Promise<OrganizationSetupRequirement> {
  const result = await client.query<SetupRequirementRow>(
    `SELECT ${REQUIREMENT_SELECT}
       FROM platform.organization_setup_requirements
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
        AND setup_requirement_id = $3::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [input.tenantId, input.setupPlanId, input.requirementId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ORGANIZATION_SETUP_REQUIREMENT_NOT_FOUND');
  return mapRequirement(row);
}

async function loadPlanById(
  client: OrganizationSetupSqlClient,
  tenantId: string,
  setupPlanId: string,
  forUpdate = false,
): Promise<OrganizationSetupPlan> {
  const result = await client.query<SetupPlanRow>(
    `SELECT ${PLAN_SELECT}
       FROM platform.organization_setup_plans
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tenantId, setupPlanId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ORGANIZATION_SETUP_PLAN_NOT_FOUND');
  return mapPlan(row);
}

export interface OrganizationSetupLegalEntityOption {
  readonly legalEntityId: string;
  readonly legalName: string;
  readonly entityType: string;
  readonly jurisdictionCountryCode: string;
}

export interface OrganizationOperatingEntityBinding {
  readonly bindingId: string;
  readonly legalEntityId: string;
  readonly legalName: string;
  readonly jurisdictionCountryCode: string;
}

export async function listVerifiedEnterpriseLegalEntities(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
  },
): Promise<readonly OrganizationSetupLegalEntityOption[]> {
  const result = await client.query<{
    readonly legal_entity_id: string;
    readonly legal_name: string;
    readonly entity_type: string;
    readonly jurisdiction_country_code: string;
  }>(
    `SELECT legal_entity_id, legal_name, entity_type, jurisdiction_country_code
       FROM platform.legal_entities
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND status = 'VERIFIED'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
      ORDER BY legal_name ASC, legal_entity_id ASC`,
    [input.tenantId, input.enterpriseId],
  );
  return result.rows.map((row) => ({
    legalEntityId: row.legal_entity_id,
    legalName: row.legal_name,
    entityType: row.entity_type,
    jurisdictionCountryCode: row.jurisdiction_country_code,
  }));
}

export async function listOrganizationOperatingEntities(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly organizationId: string;
  },
): Promise<readonly OrganizationOperatingEntityBinding[]> {
  const result = await client.query<{
    readonly organization_legal_entity_binding_id: string;
    readonly legal_entity_id: string;
    readonly legal_name: string;
    readonly jurisdiction_country_code: string;
  }>(
    `SELECT
       binding.organization_legal_entity_binding_id,
       binding.legal_entity_id,
       legal_entity.legal_name,
       legal_entity.jurisdiction_country_code
     FROM platform.organization_legal_entity_bindings binding
     JOIN platform.legal_entities legal_entity
       ON legal_entity.tenant_id = binding.tenant_id
      AND legal_entity.legal_entity_id = binding.legal_entity_id
     WHERE binding.tenant_id = $1::uuid
       AND binding.organization_id = $2::uuid
       AND binding.binding_role = 'OPERATED_BY'
       AND binding.status = 'ACTIVE'
       AND binding.valid_from <= now()
       AND (binding.valid_until IS NULL OR binding.valid_until > now())
     ORDER BY binding.valid_from ASC, binding.organization_legal_entity_binding_id ASC`,
    [input.tenantId, input.organizationId],
  );
  return result.rows.map((row) => ({
    bindingId: row.organization_legal_entity_binding_id,
    legalEntityId: row.legal_entity_id,
    legalName: row.legal_name,
    jurisdictionCountryCode: row.jurisdiction_country_code,
  }));
}

export async function assignOrganizationOperatingEntity(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly legalEntityId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly binding: OrganizationOperatingEntityBinding;
  readonly plan: OrganizationSetupPlan;
  readonly idempotent: boolean;
}> {
  const plan = await loadPlanById(client, input.tenantId, input.setupPlanId, true);
  if (plan.state === 'ACTIVATED' || plan.state === 'CANCELLED') {
    throw new Error('ORGANIZATION_SETUP_PLAN_CLOSED');
  }

  const legalEntity = await client.query<{
    readonly legal_entity_id: string;
    readonly legal_name: string;
    readonly jurisdiction_country_code: string;
  }>(
    `SELECT legal_entity_id, legal_name, jurisdiction_country_code
       FROM platform.legal_entities
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid
        AND status = 'VERIFIED'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
      LIMIT 1`,
    [input.tenantId, plan.enterpriseId, input.legalEntityId],
  );
  const entity = legalEntity.rows[0];
  if (!entity) throw new Error('ORGANIZATION_SETUP_VERIFIED_LEGAL_ENTITY_REQUIRED');

  const existing = await client.query<{
    readonly organization_legal_entity_binding_id: string;
  }>(
    `SELECT organization_legal_entity_binding_id
       FROM platform.organization_legal_entity_bindings
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND legal_entity_id = $3::uuid
        AND binding_role = 'OPERATED_BY'
        AND status = 'ACTIVE'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, plan.organizationId, input.legalEntityId],
  );
  const prior = existing.rows[0];
  if (prior) {
    return {
      binding: {
        bindingId: prior.organization_legal_entity_binding_id,
        legalEntityId: entity.legal_entity_id,
        legalName: entity.legal_name,
        jurisdictionCountryCode: entity.jurisdiction_country_code,
      },
      plan,
      idempotent: true,
    };
  }

  const bindingId = randomUUID();
  await client.query(
    `INSERT INTO platform.organization_legal_entity_bindings (
       organization_legal_entity_binding_id,
       tenant_id,
       organization_id,
       legal_entity_id,
       binding_role,
       status,
       created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'OPERATED_BY', 'ACTIVE', $5
     )`,
    [
      bindingId,
      input.tenantId,
      plan.organizationId,
      input.legalEntityId,
      input.actorSubjectId,
    ],
  );

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    eventType: 'OPERATING_ENTITY_ASSIGNED',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      organizationId: plan.organizationId,
      legalEntityId: input.legalEntityId,
      bindingId,
    },
  });
  if (!setupEvent.replay) {
    await appendSetupDomainEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.setupPlanId,
      eventType: 'organization.setup.operating_entity_assigned',
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        organizationId: plan.organizationId,
        legalEntityId: input.legalEntityId,
        bindingId,
      },
    });
  }

  const evaluated = await evaluateOrganizationSetupAutomatedRequirements(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    correlationId: input.correlationId,
  });

  return {
    binding: {
      bindingId,
      legalEntityId: entity.legal_entity_id,
      legalName: entity.legal_name,
      jurisdictionCountryCode: entity.jurisdiction_country_code,
    },
    plan: evaluated.plan,
    idempotent: false,
  };
}

export interface OrganizationSetupAutomatedEvaluation {
  readonly requirementKey: string;
  readonly satisfied: boolean;
  readonly evidenceRefs: readonly string[];
}

export async function evaluateOrganizationSetupAutomatedRequirements(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly plan: OrganizationSetupPlan;
  readonly evaluations: readonly OrganizationSetupAutomatedEvaluation[];
}> {
  const plan = await loadPlanById(client, input.tenantId, input.setupPlanId);
  if (plan.state === 'ACTIVATED' || plan.state === 'CANCELLED') {
    return { plan, evaluations: [] };
  }

  const requirements = await listOrganizationSetupRequirements(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
  });
  const organization = await client.query<{
    readonly name: string;
    readonly organization_kind: string;
    readonly parent_organization_id: string | null;
  }>(
    `SELECT name, organization_kind, parent_organization_id
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, plan.organizationId],
  );
  const operatingEntity = await client.query<{
    readonly organization_legal_entity_binding_id: string;
    readonly legal_entity_id: string;
  }>(
    `SELECT
       binding.organization_legal_entity_binding_id,
       binding.legal_entity_id
     FROM platform.organization_legal_entity_bindings binding
     JOIN platform.legal_entities legal_entity
       ON legal_entity.tenant_id = binding.tenant_id
      AND legal_entity.legal_entity_id = binding.legal_entity_id
     WHERE binding.tenant_id = $1::uuid
       AND binding.organization_id = $2::uuid
       AND binding.binding_role = 'OPERATED_BY'
       AND binding.status = 'ACTIVE'
       AND binding.valid_from <= now()
       AND (binding.valid_until IS NULL OR binding.valid_until > now())
       AND legal_entity.status = 'VERIFIED'
     ORDER BY binding.valid_from DESC, binding.organization_legal_entity_binding_id
     LIMIT 1`,
    [input.tenantId, plan.organizationId],
  );
  const setupOwner =
    plan.primaryAdministratorSubjectId === null
    || plan.primaryAdministratorIssuer === null
      ? ({ rows: [], rowCount: 0 } as OrganizationSetupSqlResult<{
          readonly setup_participant_id: string;
          readonly subject_id: string;
          readonly issuer: string | null;
        }>)
      : await client.query<{
          readonly setup_participant_id: string;
          readonly subject_id: string;
          readonly issuer: string | null;
        }>(
          `SELECT setup_participant_id, subject_id, issuer
             FROM platform.organization_setup_participants
            WHERE tenant_id = $1::uuid
              AND setup_plan_id = $2::uuid
              AND subject_id = $3
              AND issuer IS NOT DISTINCT FROM $4
              AND role = 'OWNER'
              AND status = 'ACTIVE'
              AND valid_from <= now()
              AND (valid_until IS NULL OR valid_until > now())
            LIMIT 1`,
          [
            input.tenantId,
            input.setupPlanId,
            plan.primaryAdministratorSubjectId,
            plan.primaryAdministratorIssuer,
          ],
        );

  const org = organization.rows[0];
  const binding = operatingEntity.rows[0];
  const owner = setupOwner.rows[0];
  const evaluations: OrganizationSetupAutomatedEvaluation[] = [
    {
      requirementKey: 'core.organization-profile',
      satisfied:
        org !== undefined
        && org.name.trim() !== ''
        && org.organization_kind.trim() !== ''
        && org.parent_organization_id !== null,
      evidenceRefs: org === undefined
        ? []
        : [`organization:${plan.organizationId}:profile`],
    },
    {
      requirementKey: 'core.operating-entity',
      satisfied: binding !== undefined,
      evidenceRefs: binding === undefined
        ? []
        : [
            `legal-entity:${binding.legal_entity_id}`,
            `organization-legal-entity-binding:${binding.organization_legal_entity_binding_id}`,
          ],
    },
    {
      requirementKey: 'core.primary-administrator',
      satisfied:
        owner !== undefined
        && owner.issuer !== null
        && owner.issuer.trim() !== '',
      evidenceRefs:
        owner === undefined || owner.issuer === null || owner.issuer.trim() === ''
          ? []
          : [
              `setup-participant:${owner.setup_participant_id}`,
              `subject:${owner.subject_id}`,
              `issuer:${owner.issuer}`,
            ],
    },
  ];

  const requirementsByKey = new Map(
    requirements.map((requirement) => [requirement.requirementKey, requirement]),
  );
  for (const evaluation of evaluations) {
    const requirement = requirementsByKey.get(evaluation.requirementKey);
    if (!requirement || requirement.satisfactionMode !== 'AUTOMATED') continue;

    if (evaluation.satisfied && requirement.status !== 'SATISFIED') {
      await changeOrganizationSetupRequirement(client, {
        tenantId: input.tenantId,
        setupPlanId: input.setupPlanId,
        requirementId: requirement.setupRequirementId,
        action: 'SATISFY',
        actorSubjectId: 'enterprise-readiness-system',
        reason: 'Authoritative enterprise state satisfies this automated prerequisite.',
        evidenceRefs: evaluation.evidenceRefs,
        correlationId: input.correlationId,
        idempotencyKey:
          `auto-eval:${requirement.setupRequirementId}:satisfy:${randomUUID()}`,
        systemEvaluation: true,
      });
      continue;
    }

    if (!evaluation.satisfied && requirement.status === 'SATISFIED') {
      await changeOrganizationSetupRequirement(client, {
        tenantId: input.tenantId,
        setupPlanId: input.setupPlanId,
        requirementId: requirement.setupRequirementId,
        action: 'REOPEN',
        actorSubjectId: 'enterprise-readiness-system',
        reason: 'Authoritative enterprise state no longer satisfies this automated prerequisite.',
        evidenceRefs: [],
        correlationId: input.correlationId,
        idempotencyKey:
          `auto-eval:${requirement.setupRequirementId}:reopen:${randomUUID()}`,
        systemEvaluation: true,
      });
    }
  }

  return {
    plan: await loadPlanById(client, input.tenantId, input.setupPlanId),
    evaluations,
  };
}

async function handoffSetupOwnerMembership(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly organizationId: string;
    readonly activatedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly membershipId: string;
  readonly subjectId: string;
  readonly issuer: string | null;
}> {
  const plan = await loadPlanById(client, input.tenantId, input.setupPlanId, true);
  if (
    plan.primaryAdministratorSubjectId === null
    || plan.primaryAdministratorIssuer === null
  ) {
    throw new Error('ORGANIZATION_SETUP_PRIMARY_ADMIN_REQUIRED');
  }

  const owner = await client.query<{
    readonly subject_id: string;
    readonly issuer: string | null;
    readonly valid_until: Date | string | null;
  }>(
    `SELECT subject_id, issuer, valid_until
       FROM platform.organization_setup_participants
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid
        AND subject_id = $3
        AND issuer IS NOT DISTINCT FROM $4
        AND role = 'OWNER'
        AND status = 'ACTIVE'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
      LIMIT 1
      FOR UPDATE`,
    [
      input.tenantId,
      input.setupPlanId,
      plan.primaryAdministratorSubjectId,
      plan.primaryAdministratorIssuer,
    ],
  );
  const row = owner.rows[0];
  if (!row || row.issuer === null || row.issuer.trim() === '') {
    throw new Error('ORGANIZATION_SETUP_PRIMARY_ADMIN_REQUIRED');
  }

  const existing = await client.query<{
    readonly membership_id: string;
    readonly status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  }>(
    `SELECT membership_id, status
       FROM platform.memberships
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND subject_id = $3
        AND issuer IS NOT DISTINCT FROM $4
      ORDER BY updated_at DESC, membership_id DESC
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.organizationId, row.subject_id, row.issuer],
  );
  const prior = existing.rows[0];
  let membershipId: string;

  if (prior?.status === 'SUSPENDED' || prior?.status === 'REVOKED') {
    throw new Error('ORGANIZATION_SETUP_ACCESS_HANDOFF_CONFLICT');
  }

  if (prior?.status === 'ACTIVE') {
    membershipId = prior.membership_id;
    await client.query(
      `UPDATE platform.memberships
          SET organization_scope_mode = 'SELF',
              workspace_scope_mode = 'ALL',
              operating_unit_scope_mode = 'ALL',
              valid_until = $5::timestamptz,
              updated_at = now()
        WHERE membership_id = $1::uuid
          AND tenant_id = $2::uuid
          AND organization_id = $3::uuid
          AND subject_id = $4`,
      [
        membershipId,
        input.tenantId,
        input.organizationId,
        row.subject_id,
        row.valid_until ?? null,
      ],
    );
  } else {
    membershipId = randomUUID();
    await client.query(
      `INSERT INTO platform.memberships (
         membership_id, tenant_id, organization_id, subject_id, actor_kind,
         issuer, status, workspace_scope_mode, operating_unit_scope_mode,
         organization_scope_mode, valid_until
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, 'user',
         $5, 'ACTIVE', 'ALL', 'ALL', 'SELF', $6::timestamptz
       )`,
      [
        membershipId,
        input.tenantId,
        input.organizationId,
        row.subject_id,
        row.issuer,
        row.valid_until ?? null,
      ],
    );
  }

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'tenant.access',
      aggregateId: membershipId,
      eventType: 'tenant.membership.handed_off_from_setup',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.activatedBySubjectId,
      correlationId: input.correlationId,
      payload: {
        organizationId: input.organizationId,
        setupPlanId: input.setupPlanId,
        subjectId: row.subject_id,
        organizationScopeMode: 'SELF',
        authorizationRolesGranted: [],
      },
      metadata: { source: 'enterprise.organization-setup' },
    },
  });

  return {
    membershipId,
    subjectId: row.subject_id,
    issuer: row.issuer,
  };
}

export async function activateOrganizationSetup(
  client: OrganizationSetupSqlClient,
  input: {
    readonly tenantId: string;
    readonly setupPlanId: string;
    readonly activatedBySubjectId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly reason?: string | null;
  },
): Promise<{ readonly plan: OrganizationSetupPlan; readonly idempotent: boolean }> {
  await evaluateOrganizationSetupAutomatedRequirements(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    correlationId: input.correlationId,
  });
  const plan = await loadPlanById(client, input.tenantId, input.setupPlanId, true);
  if (plan.state === 'ACTIVATED') return { plan, idempotent: true };
  if (plan.state !== 'READY_FOR_ACTIVATION') {
    throw new Error('ORGANIZATION_SETUP_NOT_READY_FOR_ACTIVATION');
  }
  if (plan.totalRequirements <= 0 || plan.blockingOpenRequirements !== 0) {
    throw new Error('ORGANIZATION_SETUP_READINESS_INVARIANT_FAILED');
  }

  const organization = await client.query<{ readonly status: string }>(
    `SELECT status
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, plan.organizationId],
  );
  if (organization.rows[0]?.status !== 'READY_FOR_ACTIVATION') {
    throw new Error('ORGANIZATION_SETUP_ORGANIZATION_NOT_READY');
  }

  const setupEvent = await appendSetupEvent(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    eventType: 'SETUP_ACTIVATED',
    fromState: 'READY_FOR_ACTIVATION',
    toState: 'ACTIVATED',
    actorSubjectId: input.activatedBySubjectId,
    reason: input.reason?.trim() || null,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: { organizationId: plan.organizationId },
  });
  if (setupEvent.replay) {
    const current = await loadPlanById(client, input.tenantId, input.setupPlanId);
    return { plan: current, idempotent: true };
  }

  await client.query(
    `UPDATE platform.organization_setup_plans
        SET state = 'ACTIVATED',
            activated_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND setup_plan_id = $2::uuid`,
    [input.tenantId, input.setupPlanId],
  );
  await client.query(
    `UPDATE platform.organizations
        SET status = 'ACTIVE',
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND status = 'READY_FOR_ACTIVATION'`,
    [input.tenantId, plan.organizationId],
  );

  const accessHandoff = await handoffSetupOwnerMembership(client, {
    tenantId: input.tenantId,
    setupPlanId: input.setupPlanId,
    organizationId: plan.organizationId,
    activatedBySubjectId: input.activatedBySubjectId,
    correlationId: input.correlationId,
  });

  await appendSetupDomainEvent(client, {
    tenantId: input.tenantId,
    aggregateId: input.setupPlanId,
    eventType: 'organization.setup.activated',
    actorSubjectId: input.activatedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      organizationId: plan.organizationId,
      membershipId: accessHandoff.membershipId,
      setupOwnerSubjectId: accessHandoff.subjectId,
      authorizationRolesGranted: [],
    },
  });
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'organization',
      aggregateId: plan.organizationId,
      eventType: 'organization.activated',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.activatedBySubjectId,
      correlationId: input.correlationId,
      payload: {
        setupPlanId: input.setupPlanId,
        membershipId: accessHandoff.membershipId,
        setupOwnerSubjectId: accessHandoff.subjectId,
        authorizationRolesGranted: [],
      },
      metadata: { source: 'enterprise.organization-setup' },
    },
  });

  return {
    plan: await loadPlanById(client, input.tenantId, input.setupPlanId),
    idempotent: false,
  };
}
