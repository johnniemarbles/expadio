import type { GovernedActionIntent } from '@expadio/governed-actions';

export interface GovernedActionIntentSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface GovernedActionIntentSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<GovernedActionIntentSqlResult<Row>>;
}

export interface PersistedGovernedActionIntent extends GovernedActionIntent {
  readonly actionIntentId: string;
  readonly createdAt: Date;
}

interface IntentRow {
  readonly action_intent_id: string;
  readonly tenant_id: string;
  readonly source_event_id: string;
  readonly source_event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly rule_key: string;
  readonly executor_class: GovernedActionIntent['executorClass'];
  readonly action_key: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly requested_by_subject_id: string;
  readonly requested_at: Date | string;
  readonly configuration: Record<string, unknown>;
  readonly policy_decision: {
    readonly allowed: true;
    readonly policyKeys: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly reasonCode: string;
    readonly evaluatedAt: string;
  };
  readonly created_at: Date | string;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: IntentRow): PersistedGovernedActionIntent {
  return {
    actionIntentId: row.action_intent_id,
    tenantId: row.tenant_id,
    sourceEventId: row.source_event_id,
    sourceEventType: row.source_event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    ruleKey: row.rule_key,
    executorClass: row.executor_class,
    actionKey: row.action_key,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    requestedBySubjectId: row.requested_by_subject_id,
    requestedAt: date(row.requested_at),
    configuration: row.configuration,
    policyDecision: {
      allowed: true,
      policyKeys: [...(row.policy_decision.policyKeys ?? [])],
      evidenceRefs: [...(row.policy_decision.evidenceRefs ?? [])],
      reasonCode: row.policy_decision.reasonCode,
      evaluatedAt: new Date(row.policy_decision.evaluatedAt),
    },
    createdAt: date(row.created_at),
  };
}

const SELECT_COLUMNS = `
  action_intent_id, tenant_id, source_event_id, source_event_type,
  aggregate_type, aggregate_id, rule_key, executor_class, action_key,
  idempotency_key, correlation_id, causation_id, requested_by_subject_id,
  requested_at, configuration, policy_decision, created_at
`;

/**
 * Persist one already-authorized Action Intent.
 *
 * Replay is idempotent: at-least-once event processing may resolve the same
 * event/rule repeatedly, but the deterministic idempotency key returns the
 * original immutable intent.
 */
export async function persistGovernedActionIntent(
  client: GovernedActionIntentSqlClient,
  intent: GovernedActionIntent,
): Promise<PersistedGovernedActionIntent> {
  const policyDecision = {
    allowed: true as const,
    policyKeys: [...intent.policyDecision.policyKeys],
    evidenceRefs: [...intent.policyDecision.evidenceRefs],
    reasonCode: intent.policyDecision.reasonCode,
    evaluatedAt: intent.policyDecision.evaluatedAt.toISOString(),
  };

  const inserted = await client.query<IntentRow>(
    `INSERT INTO platform.governed_action_intents (
       tenant_id, source_event_id, source_event_type, aggregate_type,
       aggregate_id, rule_key, executor_class, action_key, idempotency_key,
       correlation_id, causation_id, requested_by_subject_id, requested_at,
       configuration, policy_decision
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4,
       $5, $6, $7, $8, $9,
       $10, $11, $12, $13,
       $14::jsonb, $15::jsonb
     )
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [
      intent.tenantId,
      intent.sourceEventId,
      intent.sourceEventType,
      intent.aggregateType,
      intent.aggregateId,
      intent.ruleKey,
      intent.executorClass,
      intent.actionKey,
      intent.idempotencyKey,
      intent.correlationId,
      intent.causationId,
      intent.requestedBySubjectId,
      intent.requestedAt,
      JSON.stringify(intent.configuration),
      JSON.stringify(policyDecision),
    ],
  );

  const created = inserted.rows[0];
  if (created !== undefined) return mapRow(created);

  const existing = await client.query<IntentRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.governed_action_intents
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [intent.tenantId, intent.idempotencyKey],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw new Error('GOVERNED_ACTION_INTENT_IDEMPOTENCY_CONFLICT');
  }

  if (
    row.source_event_id !== intent.sourceEventId
    || row.rule_key !== intent.ruleKey
    || row.executor_class !== intent.executorClass
    || row.action_key !== intent.actionKey
  ) {
    throw new Error('GOVERNED_ACTION_INTENT_IDEMPOTENCY_COLLISION');
  }

  return mapRow(row);
}

export async function listGovernedActionIntentsForEvent(
  client: GovernedActionIntentSqlClient,
  input: { readonly tenantId: string; readonly sourceEventId: string },
): Promise<readonly PersistedGovernedActionIntent[]> {
  const result = await client.query<IntentRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.governed_action_intents
      WHERE tenant_id = $1::uuid
        AND source_event_id = $2::uuid
      ORDER BY created_at, action_intent_id`,
    [input.tenantId, input.sourceEventId],
  );
  return result.rows.map(mapRow);
}


export async function findGovernedActionIntentById(
  client: GovernedActionIntentSqlClient,
  input: { readonly tenantId: string; readonly actionIntentId: string },
): Promise<PersistedGovernedActionIntent | null> {
  const result = await client.query<IntentRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.governed_action_intents
      WHERE tenant_id = $1::uuid
        AND action_intent_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.actionIntentId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRow(row);
}
