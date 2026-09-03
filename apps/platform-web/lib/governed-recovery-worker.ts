import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  GovernedRecoveryCommandType,
  GovernedRecoveryTargetKind,
} from './governed-recovery-commands.ts';
import { requeueDeadDomainEvent } from './domain-event-operations.ts';

const DEFAULT_LEASE_MS = 120_000;

interface RecoveryCommandClaimRow {
  readonly recovery_command_id: string;
  readonly tenant_id: string;
  readonly idempotency_key: string;
  readonly command_type: GovernedRecoveryCommandType;
  readonly target_kind: GovernedRecoveryTargetKind;
  readonly target_id: string;
  readonly reason: string;
  readonly requested_by_subject_id: string;
  readonly requested_by_role_key: string;
  readonly correlation_id: string;
  readonly status: 'QUEUED' | 'CLAIMED';
}

export interface GovernedRecoveryCommandClaim {
  readonly recoveryCommandId: string;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly commandType: GovernedRecoveryCommandType;
  readonly targetKind: GovernedRecoveryTargetKind;
  readonly targetId: string;
  readonly reason: string;
  readonly requestedBySubjectId: string;
  readonly requestedByRoleKey: string;
  readonly correlationId: string;
  readonly claimToken: string;
  readonly claimExpiresAt: Date;
}

export type GovernedRecoveryWorkerResult =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'STALE_CLAIM';
      readonly recoveryCommandId: string;
      readonly reasonCode: string;
    };

function requireWorkerSubject(value: string): string {
  const normalized = value.trim();
  if (normalized === '' || /[\r\n\t]/u.test(normalized)) {
    throw new Error('RECOVERY_WORKER_SUBJECT_INVALID');
  }
  return normalized;
}

function terminalEventType(status: 'SUCCEEDED' | 'FAILED' | 'REJECTED'):
  'COMMAND_SUCCEEDED' | 'COMMAND_FAILED' | 'COMMAND_REJECTED' {
  if (status === 'SUCCEEDED') return 'COMMAND_SUCCEEDED';
  if (status === 'FAILED') return 'COMMAND_FAILED';
  return 'COMMAND_REJECTED';
}

export async function claimNextGovernedRecoveryCommand(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly workerSubjectId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  },
): Promise<GovernedRecoveryCommandClaim | null> {
  const workerSubjectId = requireWorkerSubject(input.workerSubjectId);
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('RECOVERY_COMMAND_LEASE_INVALID');
  }

  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + leaseMs);

  await client.query('BEGIN');
  try {
    const candidate = await client.query<RecoveryCommandClaimRow>(
      `SELECT recovery_command_id, tenant_id, idempotency_key, command_type,
              target_kind, target_id, reason, requested_by_subject_id,
              requested_by_role_key, correlation_id, status
         FROM platform.governed_recovery_commands
        WHERE tenant_id = $1::uuid
          AND (
            status = 'QUEUED'
            OR (status = 'CLAIMED' AND claim_expires_at <= $2::timestamptz)
          )
        ORDER BY requested_at ASC, recovery_command_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [input.tenantId, now],
    );

    const row = candidate.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      return null;
    }

    const updated = await client.query(
      `UPDATE platform.governed_recovery_commands
          SET status = 'CLAIMED',
              claim_token = $3::uuid,
              claim_expires_at = $4::timestamptz,
              claimed_at = $2::timestamptz,
              processed_at = NULL,
              last_error = NULL
        WHERE tenant_id = $1::uuid
          AND recovery_command_id = $5::uuid
          AND (
            status = 'QUEUED'
            OR (status = 'CLAIMED' AND claim_expires_at <= $2::timestamptz)
          )`,
      [input.tenantId, now, claimToken, claimExpiresAt, row.recovery_command_id],
    );
    if (updated.rowCount !== 1) {
      throw new Error('RECOVERY_COMMAND_CLAIM_FAILED');
    }

    await client.query(
      `INSERT INTO platform.governed_recovery_command_events (
         tenant_id, recovery_command_id, event_type, previous_status, new_status,
         actor_subject_id, actor_role_key, reason, evidence, occurred_at
       ) VALUES (
         $1::uuid, $2::uuid, 'COMMAND_CLAIMED', $3, 'CLAIMED',
         $4, 'INTERNAL_RECOVERY_WORKER',
         'Recovery command claimed by the internal worker.',
         $5::jsonb, $6::timestamptz
       )`,
      [
        input.tenantId,
        row.recovery_command_id,
        row.status,
        workerSubjectId,
        JSON.stringify({
          claimToken,
          claimExpiresAt: claimExpiresAt.toISOString(),
          reclaimedExpiredClaim: row.status === 'CLAIMED',
        }),
        now,
      ],
    );

    await client.query('COMMIT');
    return {
      recoveryCommandId: row.recovery_command_id,
      tenantId: row.tenant_id,
      idempotencyKey: row.idempotency_key,
      commandType: row.command_type,
      targetKind: row.target_kind,
      targetId: row.target_id,
      reason: row.reason,
      requestedBySubjectId: row.requested_by_subject_id,
      requestedByRoleKey: row.requested_by_role_key,
      correlationId: row.correlation_id,
      claimToken,
      claimExpiresAt,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function finishClaimedRecoveryCommand(
  client: PoolClient,
  input: {
    readonly claim: GovernedRecoveryCommandClaim;
    readonly status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
    readonly reasonCode: string;
    readonly reason: string;
    readonly evidence?: Readonly<Record<string, unknown>>;
    readonly now: Date;
  },
): Promise<boolean> {
  const updated = await client.query(
    `UPDATE platform.governed_recovery_commands
        SET status = $4,
            claim_token = NULL,
            claim_expires_at = NULL,
            claimed_at = NULL,
            processed_at = $5::timestamptz,
            last_error = CASE WHEN $4 = 'FAILED' THEN $6 ELSE NULL END
      WHERE tenant_id = $1::uuid
        AND recovery_command_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $5::timestamptz`,
    [
      input.claim.tenantId,
      input.claim.recoveryCommandId,
      input.claim.claimToken,
      input.status,
      input.now,
      input.status === 'FAILED' ? input.reason : null,
    ],
  );
  if (updated.rowCount !== 1) return false;

  await client.query(
    `INSERT INTO platform.governed_recovery_command_events (
       tenant_id, recovery_command_id, event_type, previous_status, new_status,
       actor_subject_id, actor_role_key, reason, evidence, occurred_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, 'CLAIMED', $4,
       $5, 'INTERNAL_RECOVERY_WORKER', $6, $7::jsonb, $8::timestamptz
     )`,
    [
      input.claim.tenantId,
      input.claim.recoveryCommandId,
      terminalEventType(input.status),
      input.status,
      'expadio-recovery-worker',
      `${input.reasonCode}: ${input.reason}`,
      JSON.stringify(input.evidence ?? {}),
      input.now,
    ],
  );
  return true;
}

function knownTargetRejection(error: unknown): boolean {
  return error instanceof Error
    && (error.message === 'DOMAIN_EVENT_OUTBOX_NOT_FOUND'
      || error.message === 'DOMAIN_EVENT_OUTBOX_NOT_DEAD');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'RECOVERY_TARGET_EXECUTION_FAILED';
}

export async function executeGovernedRecoveryCommand(
  client: PoolClient,
  input: {
    readonly claim: GovernedRecoveryCommandClaim;
    readonly now?: Date;
  },
): Promise<Exclude<GovernedRecoveryWorkerResult, { status: 'IDLE' }>> {
  const now = input.now ?? new Date();
  const claim = input.claim;

  if (claim.commandType !== 'RETRY' || claim.targetKind !== 'DOMAIN_EVENT_OUTBOX') {
    await client.query('BEGIN');
    try {
      const finished = await finishClaimedRecoveryCommand(client, {
        claim,
        status: 'REJECTED',
        reasonCode: 'RECOVERY_TARGET_NOT_SUPPORTED',
        reason: 'This bounded recovery worker only executes RETRY for DOMAIN_EVENT_OUTBOX.',
        evidence: {
          commandType: claim.commandType,
          targetKind: claim.targetKind,
          targetId: claim.targetId,
        },
        now,
      });
      if (!finished) {
        await client.query('ROLLBACK');
        return {
          status: 'STALE_CLAIM',
          recoveryCommandId: claim.recoveryCommandId,
          reasonCode: 'RECOVERY_COMMAND_STALE_CLAIM',
        };
      }
      await client.query('COMMIT');
      return {
        status: 'REJECTED',
        recoveryCommandId: claim.recoveryCommandId,
        reasonCode: 'RECOVERY_TARGET_NOT_SUPPORTED',
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  await client.query('BEGIN');
  try {
    const requeued = await requeueDeadDomainEvent(client, {
      tenantId: claim.tenantId,
      outboxId: claim.targetId,
      actorSubjectId: claim.requestedBySubjectId,
      actorRoleKey: claim.requestedByRoleKey,
      reason: claim.reason,
      correlationId: claim.correlationId,
      now,
    });

    const finished = await finishClaimedRecoveryCommand(client, {
      claim,
      status: 'SUCCEEDED',
      reasonCode: 'DOMAIN_EVENT_OUTBOX_REQUEUED',
      reason: 'Dead Domain Event outbox row was requeued through the existing audited operation.',
      evidence: {
        targetKind: claim.targetKind,
        targetId: claim.targetId,
        requeueEventId: requeued.requeueEventId,
        previousAttempts: requeued.previousAttempts,
      },
      now,
    });
    if (!finished) {
      await client.query('ROLLBACK');
      return {
        status: 'STALE_CLAIM',
        recoveryCommandId: claim.recoveryCommandId,
        reasonCode: 'RECOVERY_COMMAND_STALE_CLAIM',
      };
    }

    await client.query('COMMIT');
    return {
      status: 'SUCCEEDED',
      recoveryCommandId: claim.recoveryCommandId,
      reasonCode: 'DOMAIN_EVENT_OUTBOX_REQUEUED',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);

    const status = knownTargetRejection(error) ? 'REJECTED' : 'FAILED';
    const reasonCode = status === 'REJECTED'
      ? 'RECOVERY_TARGET_STATE_INVALID'
      : 'RECOVERY_TARGET_EXECUTION_FAILED';
    const reason = errorMessage(error);

    await client.query('BEGIN');
    try {
      const finished = await finishClaimedRecoveryCommand(client, {
        claim,
        status,
        reasonCode,
        reason,
        evidence: {
          targetKind: claim.targetKind,
          targetId: claim.targetId,
        },
        now,
      });
      if (!finished) {
        await client.query('ROLLBACK');
        return {
          status: 'STALE_CLAIM',
          recoveryCommandId: claim.recoveryCommandId,
          reasonCode: 'RECOVERY_COMMAND_STALE_CLAIM',
        };
      }
      await client.query('COMMIT');
      return {
        status,
        recoveryCommandId: claim.recoveryCommandId,
        reasonCode,
      };
    } catch (terminalError) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw terminalError;
    }
  }
}

export async function runGovernedRecoveryWorkerOnce(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly workerSubjectId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  },
): Promise<GovernedRecoveryWorkerResult> {
  const claim = await claimNextGovernedRecoveryCommand(client, input);
  if (claim === null) return { status: 'IDLE' };
  return executeGovernedRecoveryCommand(client, {
    claim,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function runGovernedRecoveryWorkerBatch(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly workerSubjectId: string;
    readonly limit: number;
  },
): Promise<{
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly rejected: number;
  readonly staleClaims: number;
}> {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit), 50));
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let rejected = 0;
  let staleClaims = 0;

  while (attempted < limit) {
    const result = await runGovernedRecoveryWorkerOnce(client, input);
    if (result.status === 'IDLE') break;
    attempted += 1;
    if (result.status === 'SUCCEEDED') succeeded += 1;
    if (result.status === 'FAILED') failed += 1;
    if (result.status === 'REJECTED') rejected += 1;
    if (result.status === 'STALE_CLAIM') staleClaims += 1;
  }

  return { attempted, succeeded, failed, rejected, staleClaims };
}
