import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

/** Fixture-only scheduling: production enqueue uses the database clock, while
 * worker tests inject a historical clock. Pin availability explicitly; never
 * change worker eligibility, event history or lease checks to accommodate tests. */
export async function setFixtureOutboxAvailableAt(
  client: PoolClient,
  tenantId: string,
  outboxId: string,
  availableAt: Date,
): Promise<void> {
  const result = await client.query(
    `UPDATE platform.domain_event_outbox
        SET available_at = $3::timestamptz
      WHERE tenant_id = $1::uuid AND outbox_id = $2::uuid
        AND status = 'PENDING' AND attempts = 0`,
    [tenantId, outboxId, availableAt],
  );
  assert.equal(result.rowCount, 1, 'Expected one fresh, tenant-scoped outbox fixture');
}
