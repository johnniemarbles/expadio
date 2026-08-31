import type {
  AgentRunEventRecord,
  AgentRunHistory,
  AgentRunRecord,
  AgentRunRepository,
  AppendAgentRunEventResult,
  RegisterAgentRunResult,
} from '@expadio/agent-runtime';
import { validateAgentRunHistory } from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';

interface RunRow {
  readonly run_id: string;
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly agent_id: string;
  readonly purpose: string;
  readonly context_bundle_reference: string;
  readonly budget_policy_reference: string;
  readonly idempotency_key: string;
  readonly requested_by_subject_id: string;
  readonly requested_at: Date | string;
  readonly created_at: Date | string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

interface EventRow {
  readonly event_id: string;
  readonly run_id: string;
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly sequence: number;
  readonly event_type: AgentRunEventRecord['eventType'];
  readonly event_reference: string;
  readonly occurred_at: Date | string;
  readonly actor_subject_id: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
  readonly cost_minor_units: number | null;
}

export class PostgresAgentRunRepository implements AgentRunRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async register(run: AgentRunRecord): Promise<RegisterAgentRunResult> {
    const result = await this.#client.query(
      `INSERT INTO platform.agent_runs (
         run_id, tenant_id, agent_id, purpose,
         context_bundle_reference, budget_policy_reference,
         idempotency_key, requested_by_subject_id,
         requested_at, created_at, reason, correlation_id, evidence_refs, organization_id
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8,
         $9::timestamptz, $10::timestamptz, $11, $12::uuid, $13::text[], $14::uuid
       )
       ON CONFLICT DO NOTHING`,
      runValues(run),
    );
    if (result.rowCount === 1) return { created: true, run };

    const existing = await this.findConflict(run);
    if (existing === null) {
      throw new Error('AGENT_RUN_CONFLICT_WITHOUT_VISIBLE_RECORD');
    }
    if (!same(existing, run)) {
      throw new Error('AGENT_RUN_IDEMPOTENCY_CONFLICT');
    }
    return { created: false, run: existing };
  }

  async append(
    event: AgentRunEventRecord,
  ): Promise<AppendAgentRunEventResult> {
    const existing = await this.findEvent(event.tenantId, event.eventId);
    if (existing !== null) {
      if (!same(existing, event)) {
        throw new Error('AGENT_RUN_EVENT_ID_CONFLICT');
      }
      return { appended: false, event: existing };
    }

    try {
      const result = await this.#client.query(
        `INSERT INTO platform.agent_run_events (
           event_id, run_id, tenant_id, sequence, event_type,
           event_reference, occurred_at, actor_subject_id, reason,
           correlation_id, evidence_refs, cost_minor_units, organization_id
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
           $7::timestamptz, $8, $9, $10::uuid, $11::text[], $12, $13::uuid
         )`,
        eventValues(event),
      );
      if (result.rowCount === 1) {
        return { appended: true, event };
      }
    } catch (error) {
      if (!sequenceConflict(error) && postgresErrorCode(error) !== '23505') {
        throw error;
      }
      const concurrent = await this.findEvent(
        event.tenantId,
        event.eventId,
      );
      if (concurrent !== null && same(concurrent, event)) {
        return { appended: false, event: concurrent };
      }
      const expected = await this.expectedSequence(
        event.tenantId,
        event.runId,
      );
      throw new Error(
        'AGENT_RUN_EVENT_SEQUENCE_CONFLICT:expected=' + expected,
      );
    }

    throw new Error('AGENT_RUN_EVENT_INSERT_DID_NOT_COMMIT');
  }

  async load(
    tenantId: string,
    runId: string,
  ): Promise<AgentRunHistory | undefined> {
    const runResult = await this.#client.query<RunRow>(
      RUN_SELECT
        + ' WHERE tenant_id = $1::uuid AND run_id = $2::uuid LIMIT 1',
      [tenantId, runId],
    );
    const row = runResult.rows[0];
    if (row === undefined) return undefined;

    const eventResult = await this.#client.query<EventRow>(
      `SELECT event_id, run_id, tenant_id, organization_id, sequence, event_type,
              event_reference, occurred_at, actor_subject_id, reason,
              correlation_id, evidence_refs, cost_minor_units
         FROM platform.agent_run_events
        WHERE tenant_id = $1::uuid AND run_id = $2::uuid
        ORDER BY sequence ASC`,
      [tenantId, runId],
    );

    return validateAgentRunHistory({
      run: mapRun(row),
      events: eventResult.rows.map(mapEvent),
    });
  }

  private async findConflict(
    run: AgentRunRecord,
  ): Promise<AgentRunRecord | null> {
    const result = await this.#client.query<RunRow>(
      RUN_SELECT
        + ` WHERE tenant_id = $1::uuid
              AND (run_id = $2::uuid OR idempotency_key = $3)
             ORDER BY created_at ASC
             LIMIT 1`,
      [run.tenantId, run.runId, run.idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRun(row);
  }

  private async findEvent(
    tenantId: string,
    eventId: string,
  ): Promise<AgentRunEventRecord | null> {
    const result = await this.#client.query<EventRow>(
      `SELECT event_id, run_id, tenant_id, organization_id, sequence, event_type,
              event_reference, occurred_at, actor_subject_id, reason,
              correlation_id, evidence_refs, cost_minor_units
         FROM platform.agent_run_events
        WHERE tenant_id = $1::uuid AND event_id = $2::uuid
        LIMIT 1`,
      [tenantId, eventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEvent(row);
  }

  private async expectedSequence(
    tenantId: string,
    runId: string,
  ): Promise<number> {
    const result = await this.#client.query<{
      readonly expected_sequence: number;
    }>(
      `SELECT COALESCE(max(sequence), 0)::integer + 1
                AS expected_sequence
         FROM platform.agent_run_events
        WHERE tenant_id = $1::uuid AND run_id = $2::uuid`,
      [tenantId, runId],
    );
    return result.rows[0]?.expected_sequence ?? 1;
  }
}

const RUN_SELECT =
  `SELECT run_id, tenant_id, organization_id, agent_id, purpose,
          context_bundle_reference, budget_policy_reference,
          idempotency_key, requested_by_subject_id,
          requested_at, created_at, reason, correlation_id, evidence_refs
     FROM platform.agent_runs`;

function runValues(run: AgentRunRecord): readonly unknown[] {
  return [
    run.runId,
    run.tenantId,
    run.agentId,
    run.purpose,
    run.contextBundleReference,
    run.budgetPolicyReference,
    run.idempotencyKey,
    run.requestedBySubjectId,
    run.requestedAt,
    run.createdAt,
    run.reason,
    run.correlationId,
    [...run.evidenceRefs],
    run.organizationId,
  ];
}

function eventValues(event: AgentRunEventRecord): readonly unknown[] {
  return [
    event.eventId,
    event.runId,
    event.tenantId,
    event.sequence,
    event.eventType,
    event.eventReference,
    event.occurredAt,
    event.actorSubjectId,
    event.reason,
    event.correlationId,
    [...event.evidenceRefs],
    event.costMinorUnits,
    event.organizationId,
  ];
}

function mapRun(row: RunRow): AgentRunRecord {
  return {
    runId: row.run_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    purpose: row.purpose,
    contextBundleReference: row.context_bundle_reference,
    budgetPolicyReference: row.budget_policy_reference,
    idempotencyKey: row.idempotency_key,
    requestedBySubjectId: row.requested_by_subject_id,
    requestedAt: iso(row.requested_at),
    createdAt: iso(row.created_at),
    reason: row.reason,
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
  };
}

function mapEvent(row: EventRow): AgentRunEventRecord {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    sequence: row.sequence,
    eventType: row.event_type,
    eventReference: row.event_reference,
    occurredAt: iso(row.occurred_at),
    actorSubjectId: row.actor_subject_id,
    reason: row.reason,
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
    costMinorUnits: row.cost_minor_units,
  };
}

function sequenceConflict(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith(
      'Agent run event sequence must be ',
    );
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
