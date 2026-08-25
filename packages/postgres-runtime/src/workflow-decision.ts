import type {
  WorkflowStageDecision,
  WorkflowStageDecisionCommitResult,
  WorkflowStageDecisionContext,
  WorkflowStageDecisionRecord,
  WorkflowStageDecisionRepository,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface DecisionRow {
  readonly decision_id: string;
  readonly tenant_id: string;
  readonly instance_id: string;
  readonly work_type_key: string;
  readonly stage_key: string;
  readonly outcome: string;
  readonly decided_by_subject_id: string;
  readonly decided_at: Date | string;
  readonly code: string;
  readonly evidence_refs: readonly string[];
}

const SELECT_COLUMNS = `decision_id, tenant_id, instance_id, work_type_key,
  stage_key, outcome, decided_by_subject_id, decided_at, code, evidence_refs`;

/**
 * PostgreSQL implementation of the immutable stage-decision repository port.
 * The supplied client must already have the effective tenant RLS context bound.
 */
export class PostgresWorkflowStageDecisionRepository
  implements WorkflowStageDecisionRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolve(context: WorkflowStageDecisionContext): Promise<WorkflowStageDecision | null> {
    const result = await this.#client.query<DecisionRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_stage_decisions
        WHERE tenant_id = $1::uuid
          AND instance_id = $2::uuid
          AND stage_key = $3
          AND work_type_key = $4
        LIMIT 1`,
      [context.tenantId, context.instanceId, context.stageKey, context.workTypeKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapDecision(row);
  }

  async record(input: WorkflowStageDecisionRecord): Promise<WorkflowStageDecisionCommitResult> {
    const inserted = await this.#client.query<DecisionRow>(
      `INSERT INTO platform.workflow_stage_decisions (
         decision_id, tenant_id, instance_id, work_type_key, stage_key,
         outcome, decided_by_subject_id, decided_at, code, evidence_refs
       ) VALUES (
         $1, $2::uuid, $3::uuid, $4, $5,
         $6, $7, $8::timestamptz, $9, $10::text[]
       )
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.decisionId,
        input.tenantId,
        input.instanceId,
        input.workTypeKey,
        input.stageKey,
        input.outcome,
        input.decidedBySubjectId,
        input.decidedAt,
        input.code,
        [...input.evidenceRefs],
      ],
    );

    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined) {
      return { status: 'COMMITTED', decision: mapDecision(insertedRow) };
    }

    const existing = await this.resolve(input);
    if (existing === null) throw new Error('WORKFLOW_STAGE_DECISION_CONFLICT_WITHOUT_EXISTING');

    if (isExactReplay(existing, input)) {
      return { status: 'ALREADY_RECORDED', decision: existing };
    }
    return { status: 'CONFLICT', existing };
  }
}

function mapDecision(row: DecisionRow): WorkflowStageDecision {
  return {
    stageKey: row.stage_key,
    status: 'RECORDED',
    decisionId: row.decision_id,
    outcome: row.outcome,
    decidedBySubjectId: row.decided_by_subject_id,
    decidedAt: toIsoString(row.decided_at),
    code: row.code,
    evidenceRefs: [...row.evidence_refs],
  };
}

function isExactReplay(
  existing: WorkflowStageDecision,
  input: WorkflowStageDecisionRecord,
): boolean {
  return existing.decisionId === input.decisionId
    && existing.outcome === input.outcome
    && existing.decidedBySubjectId === input.decidedBySubjectId
    && existing.decidedAt === new Date(input.decidedAt).toISOString()
    && existing.code === input.code
    && sameStrings(existing.evidenceRefs, input.evidenceRefs);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
