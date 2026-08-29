import type {
  WorkflowInstance,
  WorkflowInstanceCommit,
  WorkflowInstanceCommitResult,
  WorkflowInstanceRepository,
  WorkflowInstanceState,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface WorkflowInstanceRow {
  readonly instance_id: string;
  readonly tenant_id: string;
  readonly work_type_key: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly blueprint_key: string;
  readonly blueprint_version: number;
  readonly blueprint_scope: 'PLATFORM' | 'TENANT';
  readonly industry_pack_vertical_key: string | null;
  readonly industry_pack_version: number | null;
  readonly industry_pack_runtime_source: 'TENANT_PUBLISHED' | 'PLATFORM_PUBLISHED' | 'CODE_BASELINE' | 'NEUTRAL' | null;
  readonly state: WorkflowInstanceState;
  readonly current_stage_key: string | null;
  readonly revision: number;
  readonly created_at: Date | string;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly updated_at: Date | string;
}

interface CommitRow extends Partial<WorkflowInstanceRow> {
  readonly commit_status: 'COMMITTED' | 'REVISION_CONFLICT' | 'INSTANCE_NOT_FOUND';
}

const SELECT_COLUMNS = `instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope,
  industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source,
  state, current_stage_key, revision, created_at, started_at, completed_at, updated_at`;

/**
 * The same columns qualified with the UPDATE alias, whitespace-normalized.
 * SELECT_COLUMNS spans lines (its separators are ",\n  ", not ", "), so a naive
 * `replaceAll(', ', ', wi.')` leaves the first column of each wrapped line
 * unqualified — which makes `revision` ambiguous against current_row.revision in
 * the commit CTE. Split on commas and qualify every column instead.
 */
const WI_QUALIFIED_COLUMNS = SELECT_COLUMNS.split(',')
  .map((column) => `wi.${column.trim()}`)
  .join(', ');

/**
 * PostgreSQL implementation of the neutral workflow-instance persistence port.
 * The supplied client must already be operating with the effective tenant RLS
 * context bound for the current request/work unit.
 */
export class PostgresWorkflowInstanceRepository implements WorkflowInstanceRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async create(instance: WorkflowInstance): Promise<WorkflowInstance> {
    const result = await this.#client.query<WorkflowInstanceRow>(
      `INSERT INTO platform.workflow_instances (
         instance_id, tenant_id, work_type_key, subject_type, subject_id,
         blueprint_key, blueprint_version, blueprint_scope,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source,
         state, current_stage_key, revision, created_at, started_at, completed_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11,
         $12, $13, $14, $15::timestamptz, $16::timestamptz, $17::timestamptz, $18::timestamptz
       )
       RETURNING ${SELECT_COLUMNS}`,
      valuesForInstance(instance),
    );

    return mapRequiredInstance(result.rows[0], 'WORKFLOW_INSTANCE_CREATE_RETURNING_EMPTY');
  }

  async findById(input: {
    readonly tenantId: string;
    readonly instanceId: string;
  }): Promise<WorkflowInstance | null> {
    const result = await this.#client.query<WorkflowInstanceRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_instances
        WHERE tenant_id = $1::uuid
          AND instance_id = $2::uuid
        LIMIT 1`,
      [input.tenantId, input.instanceId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapInstance(row);
  }

  async commitTransition(commit: WorkflowInstanceCommit): Promise<WorkflowInstanceCommitResult> {
    const instance = commit.instance;
    const transition = commit.transition;
    const result = await this.#client.query<CommitRow>(
      `WITH current_row AS (
         SELECT instance_id, tenant_id, revision
           FROM platform.workflow_instances
          WHERE tenant_id = $1::uuid
            AND instance_id = $2::uuid
          FOR UPDATE
       ), updated AS (
         UPDATE platform.workflow_instances AS wi
            SET work_type_key = $4,
                subject_type = $5,
                subject_id = $6,
                blueprint_key = $7,
                blueprint_version = $8,
                blueprint_scope = $9,
                state = $10,
                current_stage_key = $11,
                revision = $12,
                created_at = $13::timestamptz,
                started_at = $14::timestamptz,
                completed_at = $15::timestamptz,
                updated_at = $16::timestamptz
           FROM current_row
          WHERE wi.instance_id = current_row.instance_id
            AND wi.tenant_id = current_row.tenant_id
            AND current_row.revision = $3
         RETURNING ${WI_QUALIFIED_COLUMNS}
       ), appended AS (
         INSERT INTO platform.workflow_instance_transitions (
           instance_id, tenant_id, from_stage_key, to_stage_key,
           from_state, to_state, revision, transitioned_by_subject_id,
           transitioned_at, reason
         )
         SELECT $2::uuid, $1::uuid, $17, $18, $19, $20, $21, $22, $23::timestamptz, $24
           FROM updated
         RETURNING transition_id
       )
       SELECT 'COMMITTED'::text AS commit_status, updated.*
         FROM updated, appended
       UNION ALL
       SELECT CASE WHEN EXISTS (SELECT 1 FROM current_row)
                   THEN 'REVISION_CONFLICT'::text
                   ELSE 'INSTANCE_NOT_FOUND'::text
              END AS commit_status,
              NULL::uuid AS instance_id,
              NULL::uuid AS tenant_id,
              NULL::text AS work_type_key,
              NULL::text AS subject_type,
              NULL::text AS subject_id,
              NULL::text AS blueprint_key,
              NULL::integer AS blueprint_version,
              NULL::text AS blueprint_scope,
              NULL::text AS industry_pack_vertical_key,
              NULL::integer AS industry_pack_version,
              NULL::text AS industry_pack_runtime_source,
              NULL::text AS state,
              NULL::text AS current_stage_key,
              NULL::integer AS revision,
              NULL::timestamptz AS created_at,
              NULL::timestamptz AS started_at,
              NULL::timestamptz AS completed_at,
              NULL::timestamptz AS updated_at
        WHERE NOT EXISTS (SELECT 1 FROM updated)
       LIMIT 1`,
      [
        instance.tenantId,
        instance.instanceId,
        commit.expectedRevision,
        instance.workTypeKey,
        instance.subject.type,
        instance.subject.id,
        instance.blueprint.blueprintKey,
        instance.blueprint.version,
        instance.blueprint.scope,
        instance.state,
        instance.currentStageKey ?? null,
        instance.revision,
        instance.createdAt,
        instance.startedAt ?? null,
        instance.completedAt ?? null,
        instance.updatedAt,
        transition.fromStageKey ?? null,
        transition.toStageKey,
        transition.fromState,
        transition.toState,
        transition.revision,
        transition.transitionedBySubjectId,
        transition.transitionedAt,
        transition.reason ?? null,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error('WORKFLOW_INSTANCE_COMMIT_RESULT_EMPTY');
    if (row.commit_status === 'REVISION_CONFLICT') {
      return { committed: false, reason: 'REVISION_CONFLICT' };
    }
    if (row.commit_status === 'INSTANCE_NOT_FOUND') {
      return { committed: false, reason: 'INSTANCE_NOT_FOUND' };
    }
    return {
      committed: true,
      instance: mapRequiredInstance(row as WorkflowInstanceRow, 'WORKFLOW_INSTANCE_COMMIT_ROW_INVALID'),
    };
  }
}

function valuesForInstance(instance: WorkflowInstance): readonly unknown[] {
  return [
    instance.instanceId,
    instance.tenantId,
    instance.workTypeKey,
    instance.subject.type,
    instance.subject.id,
    instance.blueprint.blueprintKey,
    instance.blueprint.version,
    instance.blueprint.scope,
    instance.industryPackProvenance?.runtimeSource === 'NEUTRAL'
      ? null
      : instance.industryPackProvenance?.verticalKey ?? null,
    instance.industryPackProvenance !== undefined && 'version' in instance.industryPackProvenance
      ? instance.industryPackProvenance.version ?? null
      : null,
    instance.industryPackProvenance?.runtimeSource ?? null,
    instance.state,
    instance.currentStageKey ?? null,
    instance.revision,
    instance.createdAt,
    instance.startedAt ?? null,
    instance.completedAt ?? null,
    instance.updatedAt,
  ];
}

function mapRequiredInstance(
  row: WorkflowInstanceRow | undefined,
  code: string,
): WorkflowInstance {
  if (row === undefined) throw new Error(code);
  return mapInstance(row);
}

function mapInstance(row: WorkflowInstanceRow): WorkflowInstance {
  return {
    instanceId: row.instance_id,
    tenantId: row.tenant_id,
    workTypeKey: row.work_type_key,
    subject: { type: row.subject_type, id: row.subject_id },
    blueprint: {
      blueprintKey: row.blueprint_key,
      version: row.blueprint_version,
      scope: row.blueprint_scope,
    },
    ...mapIndustryPackProvenance(row),
    state: row.state,
    ...(row.current_stage_key === null ? {} : { currentStageKey: row.current_stage_key }),
    revision: row.revision,
    createdAt: toIsoString(row.created_at),
    ...(row.started_at === null ? {} : { startedAt: toIsoString(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}


function mapIndustryPackProvenance(
  row: WorkflowInstanceRow,
): Pick<WorkflowInstance, 'industryPackProvenance'> | Record<string, never> {
  const source = row.industry_pack_runtime_source;
  if (source === null) return {};
  if (source === 'NEUTRAL') {
    return { industryPackProvenance: { runtimeSource: 'NEUTRAL' } };
  }
  const verticalKey = row.industry_pack_vertical_key;
  if (verticalKey === null) throw new Error('WORKFLOW_INSTANCE_PACK_PROVENANCE_VERTICAL_KEY_MISSING');
  if (source === 'CODE_BASELINE') {
    return {
      industryPackProvenance: {
        runtimeSource: source,
        verticalKey,
        ...(row.industry_pack_version === null ? {} : { version: row.industry_pack_version }),
      },
    };
  }
  if (row.industry_pack_version === null) {
    throw new Error('WORKFLOW_INSTANCE_PACK_PROVENANCE_VERSION_MISSING');
  }
  return {
    industryPackProvenance: {
      runtimeSource: source,
      verticalKey,
      version: row.industry_pack_version,
    },
  };
}
