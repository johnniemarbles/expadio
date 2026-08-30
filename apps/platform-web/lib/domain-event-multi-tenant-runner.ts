import type { Pool, PoolClient } from 'pg';
import {
  runDomainEventActionWorkerBatch,
  type DomainEventActionRunnerSummary,
} from './domain-event-action-runner';

export interface MultiTenantDomainEventRunnerTenantResult {
  readonly tenantId: string;
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly summary: DomainEventActionRunnerSummary | null;
  readonly error: string | null;
}

export interface MultiTenantDomainEventRunnerSummary {
  readonly tenantCount: number;
  readonly perTenantLimit: number;
  readonly succeededTenants: number;
  readonly failedTenants: number;
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
 * Tenant discovery is intentionally outside this function. platform.tenants is
 * FORCE-RLS protected, so this runtime does not invent an unsafe cross-tenant
 * query. A trusted control-plane caller supplies the tenant ids.
 */
export async function runDomainEventActionWorkerForTenants(
  pool: Pool,
  input: {
    readonly tenantIds: readonly string[];
    readonly perTenantLimit: number;
  },
): Promise<MultiTenantDomainEventRunnerSummary> {
  const tenants: MultiTenantDomainEventRunnerTenantResult[] = [];

  for (const tenantId of input.tenantIds) {
    let client: PoolClient | null = await pool.connect();
    let summary: DomainEventActionRunnerSummary | null = null;
    let error: string | null = null;

    try {
      await client.query(
        "SELECT set_config('app.tenant_id', $1, false)",
        [tenantId],
      );

      summary = await runDomainEventActionWorkerBatch(client, {
        tenantId,
        limit: input.perTenantLimit,
      });
    } catch (cause) {
      error = cause instanceof Error
        ? cause.message
        : 'Unknown tenant Domain Event runner failure';
    } finally {
      if (client !== null) {
        const reset = await resetOrDestroy(client);
        client = null;
        if (!reset && error === null) {
          error = 'TENANT_CONTEXT_RESET_FAILED';
          summary = null;
        }
      }
    }

    tenants.push({
      tenantId,
      status: error === null ? 'SUCCEEDED' : 'FAILED',
      summary: error === null ? summary : null,
      error,
    });
  }

  const succeeded = tenants.filter((tenant) => tenant.status === 'SUCCEEDED');
  const summaries = succeeded.flatMap((tenant) =>
    tenant.summary === null ? [] : [tenant.summary]
  );

  return {
    tenantCount: tenants.length,
    perTenantLimit: input.perTenantLimit,
    succeededTenants: succeeded.length,
    failedTenants: tenants.length - succeeded.length,
    processed: summaries.reduce((sum, summary) => sum + summary.processed, 0),
    published: summaries.reduce((sum, summary) => sum + summary.published, 0),
    failed: summaries.reduce((sum, summary) => sum + summary.failed, 0),
    dead: summaries.reduce((sum, summary) => sum + summary.dead, 0),
    staleClaim: summaries.reduce((sum, summary) => sum + summary.staleClaim, 0),
    tenants,
  };
}
