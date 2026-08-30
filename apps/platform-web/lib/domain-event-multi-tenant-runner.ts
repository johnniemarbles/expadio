import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  runDomainEventActionWorkerBatch,
  type DomainEventActionRunnerSummary,
} from './domain-event-action-runner';
import {
  acquireTenantExecutionLease,
  finishTenantExecutionRun,
} from './domain-event-tenant-execution';

export interface MultiTenantDomainEventRunnerTenantResult {
  readonly tenantId: string;
  readonly status:
    | 'SUCCEEDED'
    | 'FAILED'
    | 'LEASE_LOST'
    | 'SKIPPED_BUSY'
    | 'SKIPPED_DISABLED';
  readonly runId: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly summary: DomainEventActionRunnerSummary | null;
  readonly error: string | null;
}

export interface MultiTenantDomainEventRunnerSummary {
  readonly invocationId: string;
  readonly tenantCount: number;
  readonly perTenantLimit: number;
  readonly succeededTenants: number;
  readonly failedTenants: number;
  readonly skippedTenants: number;
  readonly leaseLostTenants: number;
  readonly processed: number;
  readonly published: number;
  readonly failed: number;
  readonly dead: number;
  readonly staleClaim: number;
  readonly tenants: readonly MultiTenantDomainEventRunnerTenantResult[];
}

async function resetOrDestroy(client: PoolClient): Promise<boolean> {
  try {
    await client.query('RESET app.tenant_id');
    client.release();
    return true;
  } catch {
    client.release(true);
    return false;
  }
}

/**
 * Run the bounded Domain Event action worker across an explicit tenant list.
 *
 * Tenant discovery stays outside this function. Each tenant tick gets its own
 * leased execution run so overlapping scheduler invocations cannot execute the
 * same tenant concurrently. The outbox remains the only work queue.
 */
export async function runDomainEventActionWorkerForTenants(
  pool: Pool,
  input: {
    readonly tenantIds: readonly string[];
    readonly perTenantLimit: number;
    readonly invocationId?: string;
    readonly tenantLeaseMs?: number;
    readonly now?: () => Date;
  },
): Promise<MultiTenantDomainEventRunnerSummary> {
  const invocationId = input.invocationId ?? randomUUID();
  const tenants: MultiTenantDomainEventRunnerTenantResult[] = [];

  for (const tenantId of input.tenantIds) {
    let client: PoolClient | null = null;
    let summary: DomainEventActionRunnerSummary | null = null;
    let error: string | null = null;
    let result: MultiTenantDomainEventRunnerTenantResult | null = null;

    try {
      client = await pool.connect();
      await client.query(
        "SELECT set_config('app.tenant_id', $1, false)",
        [tenantId],
      );

      const startedAt = input.now?.() ?? new Date();
      const acquisition = await acquireTenantExecutionLease(client, {
        tenantId,
        invocationId,
        requestedLimit: input.perTenantLimit,
        now: startedAt,
        ...(input.tenantLeaseMs === undefined
          ? {}
          : { leaseMs: input.tenantLeaseMs }),
      });

      if (!acquisition.acquired) {
        result = {
          tenantId,
          status: acquisition.reason === 'DISABLED'
            ? 'SKIPPED_DISABLED'
            : 'SKIPPED_BUSY',
          runId: acquisition.activeRunId,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          summary: null,
          error: null,
        };
      } else {
        try {
          summary = await runDomainEventActionWorkerBatch(client, {
            tenantId,
            limit: input.perTenantLimit,
            ...(input.now === undefined ? {} : { now: input.now }),
          });
        } catch (cause) {
          error = cause instanceof Error
            ? cause.message
            : 'Unknown tenant Domain Event runner failure';
        }

        const finishedAt = input.now?.() ?? new Date();
        const terminal = await finishTenantExecutionRun(client, {
          lease: acquisition.lease,
          summary,
          error,
          finishedAt,
        });
        const durationMs = Math.max(
          0,
          finishedAt.getTime() - acquisition.lease.startedAt.getTime(),
        );

        result = {
          tenantId,
          status: terminal === 'LEASE_LOST'
            ? 'LEASE_LOST'
            : terminal,
          runId: acquisition.lease.runId,
          startedAt: acquisition.lease.startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs,
          summary: terminal === 'SUCCEEDED' ? summary : null,
          error: terminal === 'LEASE_LOST'
            ? 'TENANT_EXECUTION_LEASE_LOST'
            : error,
        };
      }
    } catch (cause) {
      error = cause instanceof Error
        ? cause.message
        : 'Unknown tenant Domain Event runner failure';
      result = {
        tenantId,
        status: 'FAILED',
        runId: null,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        summary: null,
        error,
      };
    } finally {
      if (client !== null) {
        const reset = await resetOrDestroy(client);
        client = null;
        if (!reset) {
          result = {
            tenantId,
            status: 'FAILED',
            runId: result?.runId ?? null,
            startedAt: result?.startedAt ?? null,
            finishedAt: result?.finishedAt ?? null,
            durationMs: result?.durationMs ?? null,
            summary: null,
            error: 'TENANT_CONTEXT_RESET_FAILED',
          };
        }
      }
    }

    tenants.push(result ?? {
      tenantId,
      status: 'FAILED',
      runId: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      summary: null,
      error: 'TENANT_EXECUTION_RESULT_MISSING',
    });
  }

  const succeeded = tenants.filter((tenant) => tenant.status === 'SUCCEEDED');
  const failedTenants = tenants.filter(
    (tenant) => tenant.status === 'FAILED' || tenant.status === 'LEASE_LOST',
  );
  const skipped = tenants.filter(
    (tenant) => tenant.status === 'SKIPPED_BUSY'
      || tenant.status === 'SKIPPED_DISABLED',
  );
  const summaries = succeeded.flatMap((tenant) =>
    tenant.summary === null ? [] : [tenant.summary]
  );

  return {
    invocationId,
    tenantCount: tenants.length,
    perTenantLimit: input.perTenantLimit,
    succeededTenants: succeeded.length,
    failedTenants: failedTenants.length,
    skippedTenants: skipped.length,
    leaseLostTenants: tenants.filter(
      (tenant) => tenant.status === 'LEASE_LOST',
    ).length,
    processed: summaries.reduce((sum, item) => sum + item.processed, 0),
    published: summaries.reduce((sum, item) => sum + item.published, 0),
    failed: summaries.reduce((sum, item) => sum + item.failed, 0),
    dead: summaries.reduce((sum, item) => sum + item.dead, 0),
    staleClaim: summaries.reduce((sum, item) => sum + item.staleClaim, 0),
    tenants,
  };
}
