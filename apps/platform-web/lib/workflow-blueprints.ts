import type { PoolClient } from 'pg';
import { PostgresWorkflowBlueprintRepository } from '@expadio/postgres-runtime/workflow';
import type { WorkflowBlueprintDefinition } from '@expadio/workflow';

/**
 * Tenant self-serve authoring of workflow blueprints.
 *
 * A tenant does not have to run on the platform default: it can clone a platform
 * blueprint into its own DRAFT, then publish that draft ACTIVE. Once published,
 * the blueprint resolver (used by startWorkflow) prefers the tenant's ACTIVE
 * customization over the platform default for the same work type, so new case
 * workflows run on the tenant's own lifecycle.
 *
 * Every operation here is tenant-scoped by the RLS context already bound on the
 * client (from withTenantClient). The workflow_blueprints SELECT policy also
 * exposes PLATFORM rows (tenant_id IS NULL), so a plain read returns the union
 * of the platform catalogue and this tenant's own drafts/versions; INSERT/UPDATE
 * policies restrict writes to this tenant's own rows.
 */

export interface BlueprintSummary {
  readonly blueprintKey: string;
  readonly version: number;
  readonly label: string;
  readonly workTypeKey: string;
  readonly source: WorkflowBlueprintDefinition['source'];
  readonly scope: 'PLATFORM' | 'TENANT';
  readonly state: WorkflowBlueprintDefinition['state'];
  readonly stageCount: number;
  readonly publishedAt: string | null;
}

interface BlueprintListRow {
  readonly blueprint_key: string;
  readonly version: number;
  readonly label: string;
  readonly work_type_key: string;
  readonly source: WorkflowBlueprintDefinition['source'];
  readonly tenant_id: string | null;
  readonly state: WorkflowBlueprintDefinition['state'];
  readonly stage_count: number;
  readonly published_at: Date | string | null;
}

/**
 * Every blueprint visible to the tenant — the platform catalogue plus this
 * tenant's own versions — newest version first within each key, tenant rows
 * ahead of platform rows for the same key.
 *
 * The scope is filtered explicitly (platform rows, or this tenant's rows) rather
 * than left to the ambient RLS context, so the read is correct whether or not a
 * tenant GUC is bound on this particular statement.
 */
export async function listBlueprintsForAuthoring(
  client: PoolClient,
  input: { readonly tenantId: string },
): Promise<BlueprintSummary[]> {
  const result = await client.query<BlueprintListRow>(
    `SELECT blueprint_key, version, label, work_type_key, source, tenant_id, state,
            jsonb_array_length(stages) AS stage_count, published_at
       FROM platform.workflow_blueprints
      WHERE tenant_id IS NULL OR tenant_id = $1::uuid
      ORDER BY work_type_key ASC, blueprint_key ASC,
               (tenant_id IS NOT NULL) DESC, version DESC`,
    [input.tenantId],
  );
  return result.rows.map((row) => ({
    blueprintKey: row.blueprint_key,
    version: row.version,
    label: row.label,
    workTypeKey: row.work_type_key,
    source: row.source,
    scope: row.tenant_id === null ? 'PLATFORM' : 'TENANT',
    state: row.state,
    stageCount: Number(row.stage_count),
    publishedAt: row.published_at === null ? null : new Date(row.published_at).toISOString(),
  }));
}

/**
 * Run `body` in a transaction with this tenant's RLS context bound inside it.
 *
 * The GUC is transaction-local (set_config is_local=true), and a bare pooled
 * query outside a transaction does not carry it forward, so a governed write
 * must open its own transaction and re-bind the tenant here — otherwise the RLS
 * INSERT/UPDATE policies (tenant_id = current_tenant_id()) silently match no
 * rows in production. On any error the transaction is rolled back.
 */
async function withTenantTx<T>(client: PoolClient, tenantId: string, body: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await body();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export type CreateDraftResult =
  | { readonly ok: true; readonly blueprint: WorkflowBlueprintDefinition }
  | { readonly ok: false; readonly reason: 'PLATFORM_BASE_NOT_FOUND' };

/**
 * Clone the ACTIVE platform blueprint for a key into a new tenant DRAFT.
 *
 * The draft copies the platform blueprint's stages and customization flags, and
 * records the platform blueprint as its parent. Its version is the next free
 * version in the tenant's own (tenant_id, blueprint_key) namespace, so it never
 * collides with the platform versions or the tenant's earlier drafts. It opens
 * DRAFT, unpublished — publishing is a separate governed step.
 */
export async function createTenantDraftFromPlatform(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly blueprintKey: string;
    readonly label?: string;
  },
): Promise<CreateDraftResult> {
  const repository = new PostgresWorkflowBlueprintRepository(client);
  const platformVersions = await repository.listVersions({
    scope: { type: 'PLATFORM' },
    blueprintKey: input.blueprintKey,
  });
  const base = platformVersions.find((candidate) => candidate.state === 'ACTIVE')
    ?? platformVersions[0];
  if (base === undefined) return { ok: false, reason: 'PLATFORM_BASE_NOT_FOUND' };

  return withTenantTx(client, input.tenantId, async () => {
    const nextVersion = await nextTenantVersion(client, input.tenantId, input.blueprintKey);
    const draft: WorkflowBlueprintDefinition = {
      blueprintKey: base.blueprintKey,
      version: nextVersion,
      label: input.label?.trim() ? input.label.trim() : `${base.label} (customized)`,
      workTypeKey: base.workTypeKey,
      tenantId: input.tenantId,
      source: 'TENANT_CUSTOMIZED',
      parent: { blueprintKey: base.blueprintKey, version: base.version },
      state: 'DRAFT',
      allowsStageAddition: base.allowsStageAddition,
      allowsStageReorder: base.allowsStageReorder,
      allowsStageDeactivation: base.allowsStageDeactivation,
      minimumRequiredStageKeys: base.minimumRequiredStageKeys,
      stages: base.stages,
    };
    const created = await repository.create(draft);
    return { ok: true, blueprint: created };
  });
}

export type PublishResult =
  | { readonly ok: true; readonly supersededVersion: number | null }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'NOT_PUBLISHABLE' };

/**
 * Publish a tenant DRAFT/IN_REVIEW blueprint ACTIVE.
 *
 * Any version the tenant currently has ACTIVE for the same work type is first
 * SUPERSEDED, then this version is set ACTIVE with publication provenance — one
 * transaction, so the partial unique index (one ACTIVE per tenant work type) is
 * never violated and the swap is atomic. Platform rows are untouched: this only
 * changes which blueprint the resolver prefers for this tenant.
 */
export async function publishTenantBlueprint(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly blueprintKey: string;
    readonly version: number;
    readonly publishedBySubjectId: string;
  },
): Promise<PublishResult> {
  return withTenantTx(client, input.tenantId, async () => {
    const target = await client.query<{ state: string; work_type_key: string }>(
      `SELECT state, work_type_key
         FROM platform.workflow_blueprints
        WHERE tenant_id = $1::uuid AND blueprint_key = $2 AND version = $3`,
      [input.tenantId, input.blueprintKey, input.version],
    );
    const row = target.rows[0];
    if (row === undefined) return { ok: false, reason: 'NOT_FOUND' };
    if (row.state !== 'DRAFT' && row.state !== 'IN_REVIEW') return { ok: false, reason: 'NOT_PUBLISHABLE' };

    // Supersede the current ACTIVE version, then activate this one — one
    // transaction, so the partial unique index (one ACTIVE per tenant work type)
    // is never momentarily violated.
    const superseded = await client.query<{ version: number }>(
      `UPDATE platform.workflow_blueprints
          SET state = 'SUPERSEDED', updated_at = now()
        WHERE tenant_id = $1::uuid AND work_type_key = $2 AND state = 'ACTIVE'
        RETURNING version`,
      [input.tenantId, row.work_type_key],
    );
    await client.query(
      `UPDATE platform.workflow_blueprints
          SET state = 'ACTIVE', published_by_subject_id = $4, published_at = now(), updated_at = now()
        WHERE tenant_id = $1::uuid AND blueprint_key = $2 AND version = $3`,
      [input.tenantId, input.blueprintKey, input.version, input.publishedBySubjectId],
    );
    return { ok: true, supersededVersion: superseded.rows[0]?.version ?? null };
  });
}

async function nextTenantVersion(client: PoolClient, tenantId: string, blueprintKey: string): Promise<number> {
  const result = await client.query<{ max: number | null }>(
    `SELECT max(version) AS max
       FROM platform.workflow_blueprints
      WHERE tenant_id = $1::uuid AND blueprint_key = $2`,
    [tenantId, blueprintKey],
  );
  return (result.rows[0]?.max ?? 0) + 1;
}
