import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { consumeIntakeReceipt, IntakeReceiptRequired } from '../lib/communication-intake-receipt.ts';

test('intake receipts bind identity, expire, reject replay and roll back with registration', async () => {
  const pool = new pg.Pool({
    host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test', max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenantId = randomUUID();
    await client.query(`INSERT INTO platform.tenants (tenant_id, name, vertical_key)
      VALUES ($1::uuid, 'Intake receipt test', 'dentex')`, [tenantId]);
    await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.platform_admin', 'true', true)`, [tenantId]);
    const { rows } = await client.query(`INSERT INTO platform.communication_intake_receipts
      (tenant_id, subject_id, connector_key, provider_key, credential_ref, key_version,
       fingerprint, detected_capabilities, probe_warnings, probed_at)
      VALUES ($1, 'admin-a', 'receipt-test', 'resend', 'vault://test/receipt', 'v1',
        'ABCD-1234', ARRAY['email.send'], '[]', now()) RETURNING receipt_id`, [tenantId]);
    const input = { receiptId: rows[0].receipt_id, tenantId, subjectId: 'admin-a',
      connectorKey: 'receipt-test', providerKey: 'resend', credentialRef: 'vault://test/receipt' };
    for (const mismatch of [
      { receiptId: 'forged' }, { receiptId: randomUUID() }, { tenantId: randomUUID() },
      { subjectId: 'admin-b' }, { connectorKey: 'different' }, { providerKey: 'sendgrid' },
      { credentialRef: 'vault://test/other' },
    ]) await assert.rejects(consumeIntakeReceipt(client, { ...input, ...mismatch }), IntakeReceiptRequired);

    await client.query('SAVEPOINT registration');
    const receipt = await consumeIntakeReceipt(client, input);
    assert.equal(receipt.fingerprint, 'ABCD-1234');
    assert.deepEqual(receipt.detected_capabilities, ['email.send']);
    await assert.rejects(consumeIntakeReceipt(client, input), IntakeReceiptRequired);
    await client.query('ROLLBACK TO SAVEPOINT registration');
    assert.ok(await consumeIntakeReceipt(client, input), 'rollback restores the single-use receipt');
    await client.query('ROLLBACK TO SAVEPOINT registration');
    await client.query(`UPDATE platform.communication_intake_receipts
      SET created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute'
      WHERE receipt_id = $1`, [input.receiptId]);
    await assert.rejects(consumeIntakeReceipt(client, input), IntakeReceiptRequired);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
