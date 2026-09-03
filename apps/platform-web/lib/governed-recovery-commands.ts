import type { PoolClient } from 'pg';

export type GovernedRecoveryCommandType =
  | 'RETRY'
  | 'CANCEL'
  | 'MARK_RESOLVED'
  | 'CREATE_TASK_ESCALATION';

export type GovernedRecoveryTargetKind =
  | 'DOMAIN_EVENT_OUTBOX'
  | 'GOVERNED_ACTION'
  | 'SCHEDULED_GOVERNED_ACTION'
  | 'COMMUNICATION_DELIVERY'
  | 'COMMUNICATION_PROVIDER_ATTEMPT'
  | 'COMMUNICATION_PROVIDER_WEBHOOK_EVENT';

export type GovernedRecoveryCommandStatus =
  | 'QUEUED'
  | 'CLAIMED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

export interface GovernedRecoveryCommandEntry {
  readonly recoveryCommandId: string;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly commandType: GovernedRecoveryCommandType;
  readonly targetKind: GovernedRecoveryTargetKind;
  readonly targetId: string;
  readonly targetRef: Readonly<Record<string, unknown>>;
  readonly commandPayload: Readonly<Record<string, unknown>>;
  readonly status: GovernedRecoveryCommandStatus;
  readonly reason: string;
  readonly requestedBySubjectId: string;
  readonly requestedByRoleKey: string;
  readonly correlationId: string;
  readonly claimToken: string | null;
  readonly claimExpiresAt: string | null;
  readonly claimedAt: string | null;
  readonly processedAt: string | null;
  readonly lastError: string | null;
  readonly requestedAt: string;
  readonly updatedAt: string;
}

interface GovernedRecoveryCommandRow {
  readonly recovery_command_id: string;
  readonly tenant_id: string;
  readonly idempotency_key: string;
  readonly command_type: GovernedRecoveryCommandType;
  readonly target_kind: GovernedRecoveryTargetKind;
  readonly target_id: string;
  readonly target_ref: Record<string, unknown>;
  readonly command_payload: Record<string, unknown>;
  readonly status: GovernedRecoveryCommandStatus;
  readonly reason: string;
  readonly requested_by_subject_id: string;
  readonly requested_by_role_key: string;
  readonly correlation_id: string;
  readonly claim_token: string | null;
  readonly claim_expires_at: Date | string | null;
  readonly claimed_at: Date | string | null;
  readonly processed_at: Date | string | null;
  readonly last_error: string | null;
  readonly requested_at: Date | string;
  readonly updated_at: Date | string;
}

export interface GovernedRecoveryCommandFilter {
  readonly tenantId: string;
  readonly status?: GovernedRecoveryCommandStatus;
  readonly commandType?: GovernedRecoveryCommandType;
  readonly targetKind?: GovernedRecoveryTargetKind;
  readonly correlationId?: string;
  readonly limit?: number;
}

export const GOVERNED_RECOVERY_COMMAND_TYPES: readonly GovernedRecoveryCommandType[] = [
  'RETRY',
  'CANCEL',
  'MARK_RESOLVED',
  'CREATE_TASK_ESCALATION',
] as const;

export const GOVERNED_RECOVERY_TARGET_KINDS: readonly GovernedRecoveryTargetKind[] = [
  'DOMAIN_EVENT_OUTBOX',
  'GOVERNED_ACTION',
  'SCHEDULED_GOVERNED_ACTION',
  'COMMUNICATION_DELIVERY',
  'COMMUNICATION_PROVIDER_ATTEMPT',
  'COMMUNICATION_PROVIDER_WEBHOOK_EVENT',
] as const;

export const GOVERNED_RECOVERY_COMMAND_STATUSES: readonly GovernedRecoveryCommandStatus[] = [
  'QUEUED',
  'CLAIMED',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;

export function isGovernedRecoveryCommandType(value: string): value is GovernedRecoveryCommandType {
  return (GOVERNED_RECOVERY_COMMAND_TYPES as readonly string[]).includes(value);
}

export function isGovernedRecoveryTargetKind(value: string): value is GovernedRecoveryTargetKind {
  return (GOVERNED_RECOVERY_TARGET_KINDS as readonly string[]).includes(value);
}

export function isGovernedRecoveryCommandStatus(value: string): value is GovernedRecoveryCommandStatus {
  return (GOVERNED_RECOVERY_COMMAND_STATUSES as readonly string[]).includes(value);
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCommandRow(row: GovernedRecoveryCommandRow): GovernedRecoveryCommandEntry {
  return {
    recoveryCommandId: row.recovery_command_id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    commandType: row.command_type,
    targetKind: row.target_kind,
    targetId: row.target_id,
    targetRef: row.target_ref,
    commandPayload: row.command_payload,
    status: row.status,
    reason: row.reason,
    requestedBySubjectId: row.requested_by_subject_id,
    requestedByRoleKey: row.requested_by_role_key,
    correlationId: row.correlation_id,
    claimToken: row.claim_token,
    claimExpiresAt: asIso(row.claim_expires_at),
    claimedAt: asIso(row.claimed_at),
    processedAt: asIso(row.processed_at),
    lastError: row.last_error,
    requestedAt: asIso(row.requested_at) ?? new Date(row.requested_at).toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date(row.updated_at).toISOString(),
  };
}

export function clampGovernedRecoveryCommandLimit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 50;
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

export async function listGovernedRecoveryCommands(
  client: PoolClient,
  filter: GovernedRecoveryCommandFilter,
): Promise<GovernedRecoveryCommandEntry[]> {
  const clauses: string[] = ['tenant_id = $1::uuid'];
  const params: unknown[] = [filter.tenantId];

  if (filter.status !== undefined) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }

  if (filter.commandType !== undefined) {
    params.push(filter.commandType);
    clauses.push(`command_type = $${params.length}`);
  }

  if (filter.targetKind !== undefined) {
    params.push(filter.targetKind);
    clauses.push(`target_kind = $${params.length}`);
  }

  if (filter.correlationId !== undefined) {
    params.push(filter.correlationId);
    clauses.push(`correlation_id = $${params.length}::uuid`);
  }

  params.push(clampGovernedRecoveryCommandLimit(filter.limit));

  const result = await client.query<GovernedRecoveryCommandRow>(
    `SELECT recovery_command_id, tenant_id, idempotency_key, command_type,
            target_kind, target_id, target_ref, command_payload, status,
            reason, requested_by_subject_id, requested_by_role_key,
            correlation_id, claim_token, claim_expires_at, claimed_at,
            processed_at, last_error, requested_at, updated_at
       FROM platform.governed_recovery_commands
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE status
                 WHEN 'QUEUED' THEN 1
                 WHEN 'CLAIMED' THEN 2
                 WHEN 'FAILED' THEN 3
                 WHEN 'REJECTED' THEN 4
                 WHEN 'CANCELLED' THEN 5
                 ELSE 6
               END,
               requested_at DESC,
               recovery_command_id
      LIMIT $${params.length}`,
    params,
  );

  return result.rows.map(mapCommandRow);
}
