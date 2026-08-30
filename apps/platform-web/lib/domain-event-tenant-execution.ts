import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DomainEventActionRunnerSummary } from './domain-event-action-runner';

export interface TenantExecutionLease {
  readonly tenantId: string;
  readonly invocationId: string;
  readonly runId: string;
  readonly leaseToken: string;
  readonly startedAt: Date;
  readonly leaseExpiresAt: Date;
  readonly requestedLimit: number;
}

export interface TenantExecutionBusy {
  readonly acquired: false;
  readonly reason: 'BUSY' | 'DISABLED';
  readonly activeRunId: string | null;
  readonly leaseExpiresAt: Date | null;
}

export interface TenantExecutionAcquired {
  readonly acquired: true;
  readonly lease: TenantExecutionLease;
}

export type TenantExecutionAcquisition =
  | TenantExecutionBusy
  | TenantExecutionAcquired;

interface LeaseStateRow {
  readonly enabled: boolean;
  readonly current_run_id: string | null;
  readonly lease_expires_at: Date | string | null;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function positiveLeaseMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('TENANT_EXECUTION_LEASE_INVALID');
  }
  return value;
}

export async function acquireTenantExecutionLease(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly invocationId: string;
    readonly requestedLimit: number;
    readonly now?: Date;
    readonly leaseMs?: number;
  },
): Promise<TenantExecutionAcquisition> {
  const now = input.now ?? new Date();
  const leaseMs = positiveLeaseMs(input.leaseMs ?? 300_000);
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const runId = randomUUID();
  const leaseToken = randomUUID();

  await client.query('BEGIN');
  try {
    const existing = await client.query<LeaseStateRow>(
      `SELECT enabled, current_run_id, lease_expires_at
         FROM platform.domain_event_tenant_execution_state
        WHERE tenant_id = $1::uuid
        FOR UPDATE`,
      [input.tenantId],
    );
    const state = existing.rows[0];

    if (state !== undefined && !state.enabled) {
      await client.query('ROLLBACK');
      return {
        acquired: false,
        reason: 'DISABLED',
        activeRunId: state.current_run_id,
        leaseExpiresAt: state.lease_expires_at === null
          ? null
          : date(state.lease_expires_at),
      };
    }

    if (
      state?.current_run_id != null
      && state.lease_expires_at != null
      && date(state.lease_expires_at).getTime() > now.getTime()
    ) {
      await client.query('ROLLBACK');
      return {
        acquired: false,
        reason: 'BUSY',
        activeRunId: state.current_run_id,
        leaseExpiresAt: date(state.lease_expires_at),
      };
    }

    if (state?.current_run_id != null) {
      await client.query(
        `UPDATE platform.domain_event_tenant_execution_runs
            SET status = 'LEASE_LOST',
                finished_at = $3,
                duration_ms = GREATEST(
                  0,
                  floor(extract(epoch FROM ($3 - started_at)) * 1000)::bigint
                ),
                error = COALESCE(error, 'TENANT_EXECUTION_LEASE_EXPIRED'),
                updated_at = $3
          WHERE tenant_id = $1::uuid
            AND run_id = $2::uuid
            AND status = 'RUNNING'`,
        [input.tenantId, state.current_run_id, now],
      );
    }

    await client.query(
      `INSERT INTO platform.domain_event_tenant_execution_runs (
         run_id, tenant_id, invocation_id, lease_token, status,
         requested_limit, started_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'RUNNING',
         $5, $6
       )`,
      [
        runId,
        input.tenantId,
        input.invocationId,
        leaseToken,
        input.requestedLimit,
        now,
      ],
    );

    await client.query(
      `INSERT INTO platform.domain_event_tenant_execution_state (
         tenant_id, current_run_id, lease_token, lease_expires_at,
         last_started_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $5
       )
       ON CONFLICT (tenant_id) DO UPDATE
          SET current_run_id = EXCLUDED.current_run_id,
              lease_token = EXCLUDED.lease_token,
              lease_expires_at = EXCLUDED.lease_expires_at,
              last_started_at = EXCLUDED.last_started_at,
              updated_at = EXCLUDED.updated_at`,
      [input.tenantId, runId, leaseToken, leaseExpiresAt, now],
    );

    await client.query('COMMIT');
    return {
      acquired: true,
      lease: {
        tenantId: input.tenantId,
        invocationId: input.invocationId,
        runId,
        leaseToken,
        startedAt: now,
        leaseExpiresAt,
        requestedLimit: input.requestedLimit,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the acquisition failure.
    }
    throw error;
  }
}

export async function finishTenantExecutionRun(
  client: PoolClient,
  input: {
    readonly lease: TenantExecutionLease;
    readonly summary: DomainEventActionRunnerSummary | null;
    readonly error: string | null;
    readonly finishedAt?: Date;
  },
): Promise<'SUCCEEDED' | 'FAILED' | 'LEASE_LOST'> {
  const finishedAt = input.finishedAt ?? new Date();
  const durationMs = Math.max(
    0,
    finishedAt.getTime() - input.lease.startedAt.getTime(),
  );

  await client.query('BEGIN');
  try {
    const state = await client.query(
      `UPDATE platform.domain_event_tenant_execution_state
          SET current_run_id = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_finished_at = $4,
              last_success_at = CASE WHEN $5::boolean THEN $4 ELSE last_success_at END,
              last_failure_at = CASE WHEN $5::boolean THEN last_failure_at ELSE $4 END,
              last_error = $6,
              updated_at = $4
        WHERE tenant_id = $1::uuid
          AND current_run_id = $2::uuid
          AND lease_token = $3::uuid`,
      [
        input.lease.tenantId,
        input.lease.runId,
        input.lease.leaseToken,
        finishedAt,
        input.error === null,
        input.error,
      ],
    );

    const status: 'SUCCEEDED' | 'FAILED' | 'LEASE_LOST' =
      state.rowCount !== 1
        ? 'LEASE_LOST'
        : input.error === null
          ? 'SUCCEEDED'
          : 'FAILED';

    const run = await client.query(
      `UPDATE platform.domain_event_tenant_execution_runs
          SET status = $4,
              processed = $5,
              published = $6,
              failed = $7,
              dead = $8,
              stale_claim = $9,
              finished_at = $10,
              duration_ms = $11,
              error = $12,
              updated_at = $10
        WHERE tenant_id = $1::uuid
          AND run_id = $2::uuid
          AND lease_token = $3::uuid
          AND status = 'RUNNING'`,
      [
        input.lease.tenantId,
        input.lease.runId,
        input.lease.leaseToken,
        status,
        input.summary?.processed ?? 0,
        input.summary?.published ?? 0,
        input.summary?.failed ?? 0,
        input.summary?.dead ?? 0,
        input.summary?.staleClaim ?? 0,
        finishedAt,
        durationMs,
        status === 'LEASE_LOST'
          ? 'TENANT_EXECUTION_LEASE_LOST'
          : input.error,
      ],
    );
    if (run.rowCount !== 1 && status !== 'LEASE_LOST') {
      throw new Error('TENANT_EXECUTION_RUN_FINALIZE_FAILED');
    }

    await client.query('COMMIT');
    return status;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the finalization failure.
    }
    throw error;
  }
}
