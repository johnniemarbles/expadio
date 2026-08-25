import type {
  WorkflowActivationLifecycleCommitResult,
  WorkflowActivationLifecycleEvent,
  WorkflowActivationLifecycleRepository,
  WorkflowActivationLifecycleState,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface LifecycleEventRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly instance_id: string;
  readonly activation_id: string;
  readonly from_state: WorkflowActivationLifecycleState;
  readonly to_state: WorkflowActivationLifecycleState;
  readonly action: WorkflowActivationLifecycleEvent['action'];
  readonly affected_rights_grant_ids: readonly string[];
  readonly monitoring_trigger_key: string;
  readonly source_verification_id: string | null;
  readonly performed_by_subject_id: string;
  readonly performed_at: Date | string;
  readonly reason: string;
  readonly evidence_refs: readonly string[];
}

interface LifecycleStateRow {
  readonly state: WorkflowActivationLifecycleState;
}

const SELECT_COLUMNS = `event_id, tenant_id, instance_id, activation_id,
  from_state, to_state, action, affected_rights_grant_ids,
  monitoring_trigger_key, source_verification_id, performed_by_subject_id,
  performed_at, reason, evidence_refs`;

/** PostgreSQL adapter for append-only activation lifecycle history. */
export class PostgresWorkflowActivationLifecycleRepository
  implements WorkflowActivationLifecycleRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async findEvent(input: {
    readonly tenantId: string;
    readonly eventId: string;
  }): Promise<WorkflowActivationLifecycleEvent | null> {
    const result = await this.#client.query<LifecycleEventRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_activation_lifecycle_events
        WHERE tenant_id = $1::uuid
          AND event_id = $2::uuid
        LIMIT 1`,
      [input.tenantId, input.eventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEvent(row);
  }

  async currentState(input: {
    readonly tenantId: string;
    readonly activationId: string;
  }): Promise<WorkflowActivationLifecycleState | null> {
    const result = await this.#client.query<LifecycleStateRow>(
      `WITH latest AS (
         SELECT to_state AS state
           FROM platform.workflow_activation_lifecycle_events
          WHERE tenant_id = $1::uuid
            AND activation_id = $2::uuid
          ORDER BY performed_at DESC, event_id DESC
          LIMIT 1
       )
       SELECT state FROM latest
       UNION ALL
       SELECT 'ACTIVE'::text AS state
        WHERE NOT EXISTS (SELECT 1 FROM latest)
          AND EXISTS (
            SELECT 1
              FROM platform.workflow_activation_verifications
             WHERE tenant_id = $1::uuid
               AND activation_id = $2::uuid
               AND state = 'VERIFIED'
          )
       LIMIT 1`,
      [input.tenantId, input.activationId],
    );
    return result.rows[0]?.state ?? null;
  }

  async append(
    event: WorkflowActivationLifecycleEvent,
  ): Promise<WorkflowActivationLifecycleCommitResult> {
    let inserted;
    try {
      inserted = await this.#client.query<LifecycleEventRow>(
        `INSERT INTO platform.workflow_activation_lifecycle_events (
           event_id, tenant_id, instance_id, activation_id, from_state, to_state,
           action, affected_rights_grant_ids, monitoring_trigger_key,
           source_verification_id, performed_by_subject_id, performed_at,
           reason, evidence_refs
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
           $7, $8::uuid[], $9, $10::uuid, $11, $12::timestamptz,
           $13, $14::text[]
         )
         ON CONFLICT DO NOTHING
         RETURNING ${SELECT_COLUMNS}`,
        [
          event.eventId,
          event.tenantId,
          event.instanceId,
          event.activationId,
          event.fromState,
          event.toState,
          event.action,
          [...event.affectedRightsGrantIds],
          event.monitoringTriggerKey,
          event.sourceVerificationId ?? null,
          event.performedBySubjectId,
          event.performedAt,
          event.reason,
          [...event.evidenceRefs],
        ],
      );
    } catch (error) {
      if (postgresErrorCode(error) !== '23514') throw error;

      const currentState = await this.currentState({
        tenantId: event.tenantId,
        activationId: event.activationId,
      });
      if (currentState !== null && currentState !== event.fromState) {
        return { status: 'STATE_CONFLICT', currentState };
      }
      throw error;
    }

    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined) {
      return { status: 'COMMITTED', event: mapEvent(insertedRow) };
    }

    const existing = await this.findEvent({
      tenantId: event.tenantId,
      eventId: event.eventId,
    });
    if (existing === null) {
      throw new Error('WORKFLOW_ACTIVATION_LIFECYCLE_CONFLICT_WITHOUT_EXISTING');
    }

    return isExactReplay(existing, event)
      ? { status: 'ALREADY_RECORDED', event: existing }
      : { status: 'EVENT_CONFLICT', existing };
  }
}

function mapEvent(row: LifecycleEventRow): WorkflowActivationLifecycleEvent {
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    instanceId: row.instance_id,
    activationId: row.activation_id,
    fromState: row.from_state,
    toState: row.to_state,
    action: row.action,
    affectedRightsGrantIds: [...row.affected_rights_grant_ids],
    monitoringTriggerKey: row.monitoring_trigger_key,
    ...(row.source_verification_id === null
      ? {}
      : { sourceVerificationId: row.source_verification_id }),
    performedBySubjectId: row.performed_by_subject_id,
    performedAt: toIsoString(row.performed_at),
    reason: row.reason,
    evidenceRefs: [...row.evidence_refs],
  };
}

function isExactReplay(
  left: WorkflowActivationLifecycleEvent,
  right: WorkflowActivationLifecycleEvent,
): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(event: WorkflowActivationLifecycleEvent): Record<string, unknown> {
  return {
    ...event,
    affectedRightsGrantIds: [...event.affectedRightsGrantIds],
    performedAt: new Date(event.performedAt).toISOString(),
    evidenceRefs: [...event.evidenceRefs],
  };
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
