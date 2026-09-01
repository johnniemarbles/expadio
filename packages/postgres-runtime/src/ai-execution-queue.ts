import { randomUUID } from 'node:crypto';
import type { PostgresClient } from './index.ts';

export interface AiExecutionClaim {
  readonly queueId: string;
  readonly tenantId: string;
  readonly jobId: string;
  readonly attempts: number;
  readonly claimToken: string;
  readonly claimedAt: Date;
  readonly claimExpiresAt: Date;
}

interface ClaimRow {
  readonly queue_id: string;
  readonly tenant_id: string;
  readonly job_id: string;
  readonly attempts: number;
  readonly claim_token: string;
  readonly claimed_at: Date | string;
  readonly claim_expires_at: Date | string;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function positive(value: number, code: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
  return value;
}

export async function enqueueAiJob(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly jobId: string; readonly availableAt?: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.ai_job_execution_queue (
       tenant_id, job_id, available_at
     ) VALUES ($1::uuid, $2::uuid, $3::timestamptz)
     ON CONFLICT (tenant_id, job_id) DO NOTHING`,
    [input.tenantId, input.jobId, input.availableAt ?? new Date()],
  );
}

export async function claimAiJobExecution(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
    readonly maxAttempts?: number;
  },
): Promise<AiExecutionClaim | null> {
  const now = input.now ?? new Date();
  const leaseMs = positive(input.leaseMs ?? 120_000, 'AI_EXECUTION_LEASE_INVALID');
  const maxAttempts = positive(input.maxAttempts ?? 5, 'AI_EXECUTION_MAX_ATTEMPTS_INVALID');
  const token = randomUUID();
  const expires = new Date(now.getTime() + leaseMs);

  await client.query(
    `UPDATE platform.ai_job_execution_queue
        SET status = 'DEAD',
            claimed_at = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = COALESCE(last_error, 'Maximum AI execution attempts exhausted.'),
            updated_at = $2
      WHERE tenant_id = $1::uuid
        AND status = 'CLAIMED'
        AND claim_expires_at <= $2
        AND attempts >= $3`,
    [input.tenantId, now, maxAttempts],
  );

  const result = await client.query<ClaimRow>(
    `WITH candidate AS (
       SELECT queue_id
         FROM platform.ai_job_execution_queue
        WHERE tenant_id = $1::uuid
          AND attempts < $5
          AND (
            (status IN ('PENDING','FAILED') AND available_at <= $2)
            OR (status = 'CLAIMED' AND claim_expires_at <= $2)
          )
        ORDER BY available_at, created_at, queue_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE platform.ai_job_execution_queue queue
        SET status = 'CLAIMED',
            attempts = queue.attempts + 1,
            claimed_at = $2,
            claim_token = $3::uuid,
            claim_expires_at = $4,
            last_error = NULL,
            updated_at = $2
       FROM candidate
      WHERE queue.queue_id = candidate.queue_id
      RETURNING queue.queue_id, queue.tenant_id, queue.job_id,
                queue.attempts, queue.claim_token, queue.claimed_at,
                queue.claim_expires_at`,
    [input.tenantId, now, token, expires, maxAttempts],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    queueId: row.queue_id,
    tenantId: row.tenant_id,
    jobId: row.job_id,
    attempts: row.attempts,
    claimToken: row.claim_token,
    claimedAt: date(row.claimed_at),
    claimExpiresAt: date(row.claim_expires_at),
  };
}

export async function completeAiJobExecution(
  client: PostgresClient,
  input: {
    readonly claim: AiExecutionClaim;
    readonly completedAt?: Date;
  },
): Promise<boolean> {
  const at = input.completedAt ?? new Date();
  const result = await client.query(
    `UPDATE platform.ai_job_execution_queue
        SET status = 'COMPLETED',
            completed_at = $4,
            claimed_at = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = NULL,
            updated_at = $4
      WHERE tenant_id = $1::uuid
        AND queue_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $4`,
    [input.claim.tenantId, input.claim.queueId, input.claim.claimToken, at],
  );
  return result.rowCount === 1;
}

export async function failAiJobExecution(
  client: PostgresClient,
  input: {
    readonly claim: AiExecutionClaim;
    readonly error: string;
    readonly failedAt?: Date;
    readonly retryAt?: Date;
    readonly maxAttempts?: number;
  },
): Promise<'FAILED' | 'DEAD' | 'STALE_CLAIM'> {
  const at = input.failedAt ?? new Date();
  const retryAt = input.retryAt ?? new Date(at.getTime() + 60_000);
  const maxAttempts = positive(input.maxAttempts ?? 5, 'AI_EXECUTION_MAX_ATTEMPTS_INVALID');
  const result = await client.query<{ readonly status: 'FAILED' | 'DEAD' }>(
    `UPDATE platform.ai_job_execution_queue
        SET status = CASE WHEN attempts >= $6 THEN 'DEAD' ELSE 'FAILED' END,
            available_at = CASE WHEN attempts >= $6 THEN available_at ELSE $5 END,
            claimed_at = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = left($4, 4000),
            updated_at = $7
      WHERE tenant_id = $1::uuid
        AND queue_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $7
      RETURNING status`,
    [
      input.claim.tenantId,
      input.claim.queueId,
      input.claim.claimToken,
      input.error || 'Unknown AI execution failure',
      retryAt,
      maxAttempts,
      at,
    ],
  );
  return result.rows[0]?.status ?? 'STALE_CLAIM';
}
