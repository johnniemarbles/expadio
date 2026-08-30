import type { Pool, PoolClient } from 'pg';
import {
  runDomainEventActionWorkerForTenants,
  type MultiTenantDomainEventRunnerSummary,
} from './domain-event-multi-tenant-runner';

export interface DueTenantTarget {
  readonly tenantId: string;
  readonly cadenceSeconds: number;
  readonly nextScheduledAt: Date;
}

interface DueTenantRow {
  readonly tenant_id: string;
  readonly cadence_seconds: number;
  readonly next_scheduled_at: Date | string;
}

const MAX_TENANTS = 50;

function boundedTenantCount(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('TENANT_COORDINATOR_LIMIT_INVALID');
  }
  return Math.min(value, MAX_TENANTS);
}

async function withSchedulerControlPlane<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query(
      "SELECT set_config('app.scheduler_control_plane', 'on', false)",
    );
    return await work(client);
  } finally {
    try {
      await client.query('RESET app.scheduler_control_plane');
    } catch {
      client.release(true);
      released = true;
    }
    if (!released) client.release();
  }
}

export async function listDueTenantExecutionTargets(
  client: PoolClient,
  input: {
    readonly limit: number;
    readonly now?: Date;
  },
): Promise<readonly DueTenantTarget[]> {
  const limit = boundedTenantCount(input.limit);
  const now = input.now ?? new Date();

  const result = await client.query<DueTenantRow>(
    `SELECT tenant_id, cadence_seconds, next_scheduled_at
       FROM platform.domain_event_scheduler_targets
      WHERE execution_enabled = true
        AND next_scheduled_at <= $1
      ORDER BY next_scheduled_at ASC, tenant_id ASC
      LIMIT $2`,
    [now, limit],
  );

  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    cadenceSeconds: row.cadence_seconds,
    nextScheduledAt: row.next_scheduled_at instanceof Date
      ? row.next_scheduled_at
      : new Date(row.next_scheduled_at),
  }));
}

async function recordCoordinatorResults(
  client: PoolClient,
  input: {
    readonly targets: readonly DueTenantTarget[];
    readonly summary: MultiTenantDomainEventRunnerSummary;
    readonly completedAt: Date;
  },
): Promise<void> {
  const byTenant = new Map(
    input.summary.tenants.map((tenant) => [tenant.tenantId, tenant] as const),
  );

  for (const target of input.targets) {
    const result = byTenant.get(target.tenantId);
    if (result === undefined) continue;

    // BUSY means another scheduler already owns the execution lease. Do not
    // move this target's due time; the lease owner remains responsible for it.
    if (result.status === 'SKIPPED_BUSY') {
      await client.query(
        `UPDATE platform.domain_event_scheduler_targets
            SET last_selected_at = $2,
                last_invocation_id = $3::uuid,
                last_result = $4,
                updated_at = $2
          WHERE tenant_id = $1::uuid`,
        [
          target.tenantId,
          input.completedAt,
          input.summary.invocationId,
          result.status,
        ],
      );
      continue;
    }

    await client.query(
      `UPDATE platform.domain_event_scheduler_targets
          SET next_scheduled_at = $2::timestamptz + make_interval(secs => cadence_seconds),
              last_selected_at = $2,
              last_invocation_id = $3::uuid,
              last_result = $4,
              updated_at = $2
        WHERE tenant_id = $1::uuid`,
      [
        target.tenantId,
        input.completedAt,
        input.summary.invocationId,
        result.status,
      ],
    );
  }
}

export async function runDueTenantExecutionCoordinator(
  pool: Pool,
  input: {
    readonly maxTenants: number;
    readonly perTenantLimit: number;
    readonly tenantLeaseMs?: number;
    readonly now?: () => Date;
  },
): Promise<{
  readonly dueTenantCount: number;
  readonly summary: MultiTenantDomainEventRunnerSummary | null;
}> {
  return withSchedulerControlPlane(pool, async (controlPlaneClient) => {
    const selectedAt = input.now?.() ?? new Date();
    const targets = await listDueTenantExecutionTargets(controlPlaneClient, {
      limit: input.maxTenants,
      now: selectedAt,
    });

    if (targets.length === 0) {
      return {
        dueTenantCount: 0,
        summary: null,
      };
    }

    const summary = await runDomainEventActionWorkerForTenants(pool, {
      tenantIds: targets.map((target) => target.tenantId),
      perTenantLimit: input.perTenantLimit,
      ...(input.tenantLeaseMs === undefined
        ? {}
        : { tenantLeaseMs: input.tenantLeaseMs }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });

    const completedAt = input.now?.() ?? new Date();
    await recordCoordinatorResults(controlPlaneClient, {
      targets,
      summary,
      completedAt,
    });

    return {
      dueTenantCount: targets.length,
      summary,
    };
  });
}
