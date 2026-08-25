import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresCommunicationSuppressionRepository } from '../src/suppression.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const suppressionRow = {
  suppression_id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: '22222222-2222-2222-2222-222222222222',
  recipient_key: 'person@example.com',
  channel: 'email',
  reason: 'UNSUBSCRIBE',
  source_message_id: 'message-1',
  recorded_at: '2026-08-25T03:00:00.000Z',
  valid_until: null,
};

test('findActive is tenant-bound and prefers organization-specific over tenant-wide suppression', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [suppressionRow], rowCount: 1 });

  const result = await new PostgresCommunicationSuppressionRepository(client).findActive({
    tenantId: suppressionRow.tenant_id,
    organizationId: suppressionRow.organization_id,
    recipientKey: 'PERSON@EXAMPLE.COM',
    channel: 'email',
    at: '2026-08-25T03:30:00.000Z',
  });

  assert.equal(result?.suppressionId, suppressionRow.suppression_id);
  assert.equal(result?.organizationId, suppressionRow.organization_id);
  assert.equal(result?.reason, 'UNSUBSCRIBE');
  assert.deepEqual(client.calls[0]?.values, [
    suppressionRow.tenant_id,
    suppressionRow.organization_id,
    'PERSON@EXAMPLE.COM',
    'email',
    '2026-08-25T03:30:00.000Z',
  ]);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY \(organization_id IS NOT NULL\) DESC/);
  assert.match(client.calls[0]?.text ?? '', /valid_until IS NULL OR valid_until >/);
});

test('findActive without organization only considers tenant-wide suppression', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresCommunicationSuppressionRepository(client).findActive({
    tenantId: suppressionRow.tenant_id,
    recipientKey: suppressionRow.recipient_key,
    channel: 'email',
  });

  assert.equal(result, null);
  assert.equal(client.calls[0]?.values[1], null);
  assert.match(client.calls[0]?.text ?? '', /\$2::uuid IS NULL AND organization_id IS NULL/);
});

test('add maps tenant suppression fields without provider-specific data', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [suppressionRow], rowCount: 1 });

  const result = await new PostgresCommunicationSuppressionRepository(client).add({
    tenantId: suppressionRow.tenant_id,
    organizationId: suppressionRow.organization_id,
    recipientKey: suppressionRow.recipient_key,
    channel: 'email',
    reason: 'UNSUBSCRIBE',
    sourceMessageId: 'message-1',
    recordedAt: '2026-08-25T03:00:00.000Z',
  });

  assert.deepEqual(result, {
    suppressionId: suppressionRow.suppression_id,
    tenantId: suppressionRow.tenant_id,
    organizationId: suppressionRow.organization_id,
    recipientKey: suppressionRow.recipient_key,
    channel: 'email',
    reason: 'UNSUBSCRIBE',
    sourceMessageId: 'message-1',
    recordedAt: '2026-08-25T03:00:00.000Z',
  });
  assert.deepEqual(client.calls[0]?.values, [
    suppressionRow.tenant_id,
    suppressionRow.organization_id,
    suppressionRow.recipient_key,
    'email',
    'UNSUBSCRIBE',
    'message-1',
    '2026-08-25T03:00:00.000Z',
    null,
  ]);
});

test('revoke updates only an active suppression inside the tenant boundary', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 1 });
  client.responses.push({ rows: [], rowCount: 0 });
  const repository = new PostgresCommunicationSuppressionRepository(client);

  assert.equal(await repository.revoke({
    tenantId: suppressionRow.tenant_id,
    suppressionId: suppressionRow.suppression_id,
    revokedAt: '2026-08-25T04:00:00.000Z',
  }), true);
  assert.equal(await repository.revoke({
    tenantId: suppressionRow.tenant_id,
    suppressionId: suppressionRow.suppression_id,
  }), false);

  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[0]?.text ?? '', /status = 'ACTIVE'/);
  assert.deepEqual(client.calls[0]?.values, [
    suppressionRow.tenant_id,
    suppressionRow.suppression_id,
    '2026-08-25T04:00:00.000Z',
  ]);
});
