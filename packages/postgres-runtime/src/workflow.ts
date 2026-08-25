import type {
  WorkflowBlueprintDefinition,
  WorkflowBlueprintIdentity,
  WorkflowBlueprintRepository,
  WorkflowBlueprintScope,
  WorkflowBlueprintSource,
  WorkflowBlueprintState,
  WorkflowStageDefinition,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface WorkflowBlueprintRow {
  readonly tenant_id: string | null;
  readonly blueprint_key: string;
  readonly version: number;
  readonly label: string;
  readonly work_type_key: string;
  readonly source: WorkflowBlueprintSource;
  readonly parent_blueprint_key: string | null;
  readonly parent_blueprint_version: number | null;
  readonly state: WorkflowBlueprintState;
  readonly allows_stage_addition: boolean;
  readonly allows_stage_reorder: boolean;
  readonly allows_stage_deactivation: boolean;
  readonly minimum_required_stage_keys: readonly string[];
  readonly stages: readonly WorkflowStageDefinition[];
  readonly published_by_subject_id: string | null;
  readonly published_at: Date | string | null;
}

const SELECT_COLUMNS = `tenant_id, blueprint_key, version, label, work_type_key,
  source, parent_blueprint_key, parent_blueprint_version, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at`;

/**
 * PostgreSQL adapter for the workflow blueprint persistence port.
 *
 * Tenant-scoped operations rely on the caller binding the same tenant to the
 * transaction-local PostgreSQL RLS context before invoking this repository.
 * Platform writes are deliberately outside this tenant runtime adapter.
 */
export class PostgresWorkflowBlueprintRepository implements WorkflowBlueprintRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async create(definition: WorkflowBlueprintDefinition): Promise<WorkflowBlueprintDefinition> {
    const result = await this.#client.query<WorkflowBlueprintRow>(
      `INSERT INTO platform.workflow_blueprints (
         tenant_id, blueprint_key, version, label, work_type_key, source,
         parent_blueprint_key, parent_blueprint_version, state,
         allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
         minimum_required_stage_keys, stages, published_by_subject_id, published_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6,
         $7, $8, $9,
         $10, $11, $12,
         $13::text[], $14::jsonb, $15, $16::timestamptz
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        definition.tenantId ?? null,
        definition.blueprintKey,
        definition.version,
        definition.label,
        definition.workTypeKey,
        definition.source,
        definition.parent?.blueprintKey ?? null,
        definition.parent?.version ?? null,
        definition.state,
        definition.allowsStageAddition,
        definition.allowsStageReorder,
        definition.allowsStageDeactivation,
        [...definition.minimumRequiredStageKeys],
        JSON.stringify(definition.stages),
        definition.publishedBySubjectId ?? null,
        definition.publishedAt ?? null,
      ],
    );

    return mapRequiredRow(result.rows[0], 'WORKFLOW_BLUEPRINT_CREATE_RETURNING_EMPTY');
  }

  async findByIdentity(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly identity: WorkflowBlueprintIdentity;
  }): Promise<WorkflowBlueprintDefinition | null> {
    const tenantId = input.scope.type === 'TENANT' ? input.scope.tenantId : null;
    const result = await this.#client.query<WorkflowBlueprintRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_blueprints
        WHERE blueprint_key = $2
          AND version = $3
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
        LIMIT 1`,
      [tenantId, input.identity.blueprintKey, input.identity.version],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async listVersions(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly blueprintKey: string;
  }): Promise<readonly WorkflowBlueprintDefinition[]> {
    const tenantId = input.scope.type === 'TENANT' ? input.scope.tenantId : null;
    const result = await this.#client.query<WorkflowBlueprintRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_blueprints
        WHERE blueprint_key = $2
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
        ORDER BY version DESC`,
      [tenantId, input.blueprintKey],
    );

    return result.rows.map(mapRow);
  }

  async listActiveForWorkType(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly workTypeKey: string;
  }): Promise<readonly WorkflowBlueprintDefinition[]> {
    const tenantId = input.scope.type === 'TENANT' ? input.scope.tenantId : null;
    const result = await this.#client.query<WorkflowBlueprintRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_blueprints
        WHERE work_type_key = $2
          AND state = 'ACTIVE'
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
        ORDER BY version DESC, blueprint_key ASC`,
      [tenantId, input.workTypeKey],
    );

    return result.rows.map(mapRow);
  }
}

function mapRequiredRow(
  row: WorkflowBlueprintRow | undefined,
  code: string,
): WorkflowBlueprintDefinition {
  if (row === undefined) throw new Error(code);
  return mapRow(row);
}

function mapRow(row: WorkflowBlueprintRow): WorkflowBlueprintDefinition {
  return {
    blueprintKey: row.blueprint_key,
    version: row.version,
    label: row.label,
    workTypeKey: row.work_type_key,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    source: row.source,
    ...(row.parent_blueprint_key === null || row.parent_blueprint_version === null
      ? {}
      : {
          parent: {
            blueprintKey: row.parent_blueprint_key,
            version: row.parent_blueprint_version,
          },
        }),
    state: row.state,
    allowsStageAddition: row.allows_stage_addition,
    allowsStageReorder: row.allows_stage_reorder,
    allowsStageDeactivation: row.allows_stage_deactivation,
    minimumRequiredStageKeys: [...row.minimum_required_stage_keys],
    stages: row.stages.map((stage) => ({ ...stage })),
    ...(row.published_by_subject_id === null
      ? {}
      : { publishedBySubjectId: row.published_by_subject_id }),
    ...(row.published_at === null
      ? {}
      : { publishedAt: toIsoString(row.published_at) }),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
