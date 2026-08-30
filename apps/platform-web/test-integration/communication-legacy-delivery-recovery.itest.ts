import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime/delivery';
import {
  cancelLegacyCommunicationDelivery,
  listLegacyCommunicationDeliveries,
} from '../lib/communication-legacy-delivery-recovery';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

test('legacy PENDING delivery is surfaced as MIGRATION_REQUIRED and resolves once with audit evidence', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Legacy delivery recovery tenant')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const delivery = await new PostgresCommunicationDeliveryRepository(c).createOrGet({
      tenantId,
      idempotencyKey: `legacy-${randomUUID()}`,
      channel: 'email',
      connectorKey: 'legacy-email',
      adapterKey: 'legacy-email-v0',
      requestedAt: '2026-08-01T10:00:00.000Z',
    });
    assert.equal(delivery.dispatchSnapshot, undefined);
    assert.equal(delivery.state, 'PENDING');

    const pending = await listLegacyCommunicationDeliveries(c, { tenantId });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.deliveryId, delivery.deliveryId);
    assert.equal(pending[0]?.recoveryStatus, 'MIGRATION_REQUIRED');

    const correlationId = randomUUID();
    const result = await cancelLegacyCommunicationDelivery(c, {
      tenantId,
      deliveryId: delivery.deliveryId,
      actorSubjectId: 'governance-admin-1',
      actorRoleKey: 'TENANT_ADMIN',
      reason: 'Legacy row predates immutable prepared dispatch and cannot be safely executed.',
      correlationId,
      now: new Date('2026-08-30T12:00:00.000Z'),
    });

    assert.equal(result.deliveryId, delivery.deliveryId);
    assert.equal(result.resolution, 'CANCELLED');
    assert.equal(result.resolvedAt, '2026-08-30T12:00:00.000Z');
    assert.equal((await listLegacyCommunicationDeliveries(c, { tenantId })).length, 0);

    const row = (await c.query(
      `SELECT state, last_reason_code, dispatch_snapshot
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, delivery.deliveryId],
    )).rows[0];
    assert.deepEqual(row, {
      state: 'CANCELLED',
      last_reason_code: 'LEGACY_DISPATCH_MIGRATION_CANCELLED',
      dispatch_snapshot: null,
    });

    const recovery = (await c.query(
      `SELECT previous_state, resolution, authorized_by_subject_id,
              authorized_by_role_key, correlation_id, reason
         FROM platform.communication_legacy_delivery_recovery_events
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, delivery.deliveryId],
    )).rows[0];
    assert.deepEqual(recovery, {
      previous_state: 'PENDING',
      resolution: 'CANCELLED',
      authorized_by_subject_id: 'governance-admin-1',
      authorized_by_role_key: 'TENANT_ADMIN',
      correlation_id: correlationId,
      reason: 'Legacy row predates immutable prepared dispatch and cannot be safely executed.',
    });

    const event = (await c.query(
      `SELECT from_state, to_state, reason_code
         FROM platform.communication_delivery_events
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [tenantId, delivery.deliveryId],
    )).rows[0];
    assert.deepEqual(event, {
      from_state: 'PENDING',
      to_state: 'CANCELLED',
      reason_code: 'LEGACY_DISPATCH_MIGRATION_CANCELLED',
    });

    await assert.rejects(
      () => cancelLegacyCommunicationDelivery(c, {
        tenantId,
        deliveryId: delivery.deliveryId,
        actorSubjectId: 'governance-admin-1',
        actorRoleKey: 'TENANT_ADMIN',
        reason: 'repeat',
        correlationId: randomUUID(),
      }),
      /LEGACY_DELIVERY_NOT_RECOVERABLE/,
    );
  } finally {
    c.release();
    await p.end();
  }
});
