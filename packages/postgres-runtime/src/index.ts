import type {
  CapabilityStateCommit,
  CapabilityStateRepository,
  CapabilityStateSnapshot,
} from '@expadio/capability-persistence';
import type { EffectiveContext, IdentityContext, MembershipContext } from '@expadio/tenancy';
import {
  databaseSessionSettings,
  type MembershipRepository,
} from '@expadio/tenancy-persistence';

export interface SqlQueryResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Structural subset implemented by node-postgres PoolClient and compatible drivers. */
export interface PostgresClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  release?(): void;
}

/** Structural subset implemented by node-postgres Pool. */
export interface PostgresPool {
  connect(): Promise<PostgresClient>;
}

interface MembershipRow {
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly workspace_scope_mode: 'ALL' | 'SELECTED';
  readonly workspace_ids: readonly string[] | null;
  readonly operating_unit_scope_mode: 'ALL' | 'SELECTED';
  readonly operating_unit_ids: readonly string[] | null;
}

export class PostgresMembershipRepository implements MembershipRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async listActiveMemberships(identity: IdentityContext): Promise<readonly MembershipContext[]> {
    const result = await this.#client.query<MembershipRow>(
      `SELECT tenant_id, organization_id, workspace_scope_mode, workspace_ids,
              operating_unit_scope_mode, operating_unit_ids
         FROM platform.active_memberships_for_subject($1, $2)`,
      [identity.subjectId, identity.issuer ?? null],
    );

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      ...(row.workspace_scope_mode === 'SELECTED'
        ? { workspaceIds: [...(row.workspace_ids ?? [])] }
        : {}),
      ...(row.operating_unit_scope_mode === 'SELECTED'
        ? { operatingUnitIds: [...(row.operating_unit_ids ?? [])] }
        : {}),
    }));
  }
}

interface CapabilityStateRow {
  readonly binding_id: string;
  readonly tenant_id: string;
  readonly state: CapabilityStateSnapshot['state'];
  readonly reason_key: string | null;
  readonly blocking_step_key: string | null;
  readonly blocking_bound_key: string | null;
  readonly if_you_do_nothing: readonly string[];
  readonly input_hash: string;
  readonly version: number;
  readonly resolved_at: Date | string;
}

export class PostgresCapabilityStateRepository implements CapabilityStateRepository {
  readonly #client: PostgresClient;

  /**
   * The supplied client must belong to the request transaction after tenant
   * context has been bound. `commit` relies on that outer transaction so the
   * snapshot update and transition event append are atomic.
   */
  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async load(tenantId: string, bindingId: string): Promise<CapabilityStateSnapshot | null> {
    const result = await this.#client.query<CapabilityStateRow>(
      `SELECT binding_id, tenant_id, state, reason_key, blocking_step_key,
              blocking_bound_key, if_you_do_nothing, input_hash, version, resolved_at
         FROM platform.capability_state
        WHERE tenant_id = $1::uuid AND binding_id = $2::uuid`,
      [tenantId, bindingId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      bindingId: row.binding_id,
      tenantId: row.tenant_id,
      state: row.state,
      reasonKey: row.reason_key,
      blockingStepKey: row.blocking_step_key,
      blockingBoundKey: row.blocking_bound_key,
      ifYouDoNothing: [...row.if_you_do_nothing],
      inputHash: row.input_hash,
      version: row.version,
      resolvedAt: row.resolved_at instanceof Date ? row.resolved_at : new Date(row.resolved_at),
    };
  }

  async commit(change: CapabilityStateCommit): Promise<void> {
    const { snapshot } = change;
    let mutation: SqlQueryResult;

    if (change.expectedVersion === null) {
      mutation = await this.#client.query(
        `INSERT INTO platform.capability_state (
           binding_id, tenant_id, state, reason_key, blocking_step_key,
           blocking_bound_key, if_you_do_nothing, input_hash, version, resolved_at
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (binding_id) DO NOTHING`,
        [
          snapshot.bindingId,
          snapshot.tenantId,
          snapshot.state,
          snapshot.reasonKey,
          snapshot.blockingStepKey,
          snapshot.blockingBoundKey,
          JSON.stringify(snapshot.ifYouDoNothing),
          snapshot.inputHash,
          snapshot.version,
          snapshot.resolvedAt,
        ],
      );
    } else {
      mutation = await this.#client.query(
        `UPDATE platform.capability_state
            SET state = $3,
                reason_key = $4,
                blocking_step_key = $5,
                blocking_bound_key = $6,
                if_you_do_nothing = $7::jsonb,
                input_hash = $8,
                version = $9,
                resolved_at = $10
          WHERE binding_id = $1::uuid
            AND tenant_id = $2::uuid
            AND version = $11`,
        [
          snapshot.bindingId,
          snapshot.tenantId,
          snapshot.state,
          snapshot.reasonKey,
          snapshot.blockingStepKey,
          snapshot.blockingBoundKey,
          JSON.stringify(snapshot.ifYouDoNothing),
          snapshot.inputHash,
          snapshot.version,
          snapshot.resolvedAt,
          change.expectedVersion,
        ],
      );
    }

    if (mutation.rowCount !== 1) {
      throw new Error('CAPABILITY_STATE_CONCURRENCY_CONFLICT');
    }

    if (change.event !== null) {
      await this.#client.query(
        `INSERT INTO platform.capability_state_events (
           binding_id, tenant_id, from_state, to_state, reason_key, input_hash, occurred_at
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        [
          change.event.bindingId,
          change.event.tenantId,
          change.event.fromState,
          change.event.toState,
          change.event.reasonKey,
          change.event.inputHash,
          change.event.occurredAt,
        ],
      );
    }
  }
}

export async function bindEffectiveContextToPostgres(
  client: PostgresClient,
  context: EffectiveContext,
): Promise<void> {
  for (const setting of databaseSessionSettings(context)) {
    await client.query(`SELECT set_config($1, $2, true)`, [setting.key, setting.value]);
  }
}

/**
 * Executes one request/work unit with transaction-local RLS context. Any
 * failure rolls back both business mutations and capability state/audit writes.
 */
export async function withEffectiveContextTransaction<Result>(
  pool: PostgresPool,
  context: EffectiveContext,
  work: (client: PostgresClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bindEffectiveContextToPostgres(client, context);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure; pool/client health handling belongs to
      // the concrete driver/runtime composition root.
    }
    throw error;
  } finally {
    client.release?.();
  }
}
export * from './delivery.ts';
export * from './communication-throttle.ts';
export * from './decision-trace.ts';

export * from './entity-relationship.ts';

export * from './domain-events.ts';

export * from './governed-action-intent.ts';

export * from './governed-action-execution-attempt.ts';
