import type { PoolClient } from 'pg';

export interface LegacyCommunicationDelivery {
  readonly deliveryId: string;
  readonly channel: string;
  readonly connectorKey: string;
  readonly adapterKey: string;
  readonly attemptCount: number;
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly recoveryStatus: 'MIGRATION_REQUIRED';
}

interface LegacyDeliveryRow {
  readonly delivery_id: string;
  readonly channel: string;
  readonly connector_key: string;
  readonly adapter_key: string;
  readonly attempt_count: number;
  readonly requested_at: Date | string;
  readonly updated_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: LegacyDeliveryRow): LegacyCommunicationDelivery {
  return {
    deliveryId: row.delivery_id,
    channel: row.channel,
    connectorKey: row.connector_key,
    adapterKey: row.adapter_key,
    attemptCount: row.attempt_count,
    requestedAt: iso(row.requested_at),
    updatedAt: iso(row.updated_at),
    recoveryStatus: 'MIGRATION_REQUIRED',
  };
}

export async function listLegacyCommunicationDeliveries(
  client: PoolClient,
  input: { readonly tenantId: string; readonly limit?: number },
): Promise<readonly LegacyCommunicationDelivery[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  const result = await client.query<LegacyDeliveryRow>(
    `SELECT delivery_id, channel, connector_key, adapter_key, attempt_count,
            requested_at, updated_at
       FROM platform.communication_deliveries
      WHERE tenant_id = $1::uuid
        AND state = 'PENDING'
        AND dispatch_snapshot IS NULL
      ORDER BY requested_at, delivery_id
      LIMIT $2`,
    [input.tenantId, limit],
  );
  return result.rows.map(mapRow);
}

export interface LegacyCommunicationDeliveryRecoveryResult {
  readonly deliveryId: string;
  readonly recoveryEventId: string;
  readonly resolution: 'CANCELLED';
  readonly resolvedAt: string;
}

export async function cancelLegacyCommunicationDelivery(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly deliveryId: string;
    readonly actorSubjectId: string;
    readonly actorRoleKey: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now?: Date;
  },
): Promise<LegacyCommunicationDeliveryRecoveryResult> {
  const reason = input.reason.trim();
  if (reason === '') throw new Error('LEGACY_DELIVERY_RECOVERY_REASON_REQUIRED');
  const now = input.now ?? new Date();

  const locked = await client.query<LegacyDeliveryRow & {
    readonly state: string;
    readonly dispatch_snapshot: unknown | null;
  }>(
    `SELECT delivery_id, channel, connector_key, adapter_key, attempt_count,
            requested_at, updated_at, state, dispatch_snapshot
       FROM platform.communication_deliveries
      WHERE tenant_id = $1::uuid
        AND delivery_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.deliveryId],
  );
  const row = locked.rows[0];
  if (row === undefined) throw new Error('LEGACY_DELIVERY_NOT_FOUND');
  if (row.state !== 'PENDING' || row.dispatch_snapshot !== null) {
    throw new Error('LEGACY_DELIVERY_NOT_RECOVERABLE');
  }

  const audit = await client.query<{ recovery_event_id: string }>(
    `INSERT INTO platform.communication_legacy_delivery_recovery_events (
       tenant_id, delivery_id, previous_state, resolution, reason,
       authorized_by_subject_id, authorized_by_role_key, correlation_id, resolved_at
     ) VALUES (
       $1::uuid, $2::uuid, 'PENDING', 'CANCELLED', $3,
       $4, $5, $6::uuid, $7::timestamptz
     )
     RETURNING recovery_event_id`,
    [
      input.tenantId,
      input.deliveryId,
      reason,
      input.actorSubjectId,
      input.actorRoleKey,
      input.correlationId,
      now,
    ],
  );
  const recoveryEventId = audit.rows[0]?.recovery_event_id;
  if (recoveryEventId === undefined) {
    throw new Error('LEGACY_DELIVERY_RECOVERY_AUDIT_FAILED');
  }

  const updated = await client.query<LegacyDeliveryRow>(
    `UPDATE platform.communication_deliveries
        SET state = 'CANCELLED',
            last_reason_code = 'LEGACY_DISPATCH_MIGRATION_CANCELLED',
            last_reason = $3,
            claim_token = NULL,
            claim_expires_at = NULL,
            updated_at = $4::timestamptz
      WHERE tenant_id = $1::uuid
        AND delivery_id = $2::uuid
        AND state = 'PENDING'
        AND dispatch_snapshot IS NULL
      RETURNING delivery_id, channel, connector_key, adapter_key, attempt_count,
                requested_at, updated_at`,
    [input.tenantId, input.deliveryId, reason, now],
  );
  const cancelled = updated.rows[0];
  if (cancelled === undefined) {
    throw new Error('LEGACY_DELIVERY_RECOVERY_CONFLICT');
  }

  await client.query(
    `INSERT INTO platform.communication_delivery_events (
       delivery_id, tenant_id, from_state, to_state, reason_code, reason, occurred_at
     ) VALUES (
       $1::uuid, $2::uuid, 'PENDING', 'CANCELLED',
       'LEGACY_DISPATCH_MIGRATION_CANCELLED', $3, $4::timestamptz
     )`,
    [input.deliveryId, input.tenantId, reason, now],
  );

  return {
    deliveryId: cancelled.delivery_id,
    recoveryEventId,
    resolution: 'CANCELLED',
    resolvedAt: now.toISOString(),
  };
}
