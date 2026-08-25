import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresCommunicationSenderRepository } from '../src/sender.ts';
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

const organizationRow = {
  sender_id: '11111111-1111-1111-1111-111111111111',
  scope: 'ORGANIZATION',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  channel: 'email',
  address: 'hello@example.test',
  display_name: 'Example',
  reply_to: 'reply@example.test',
  purposes: ['transactional', 'marketing'],
  is_default: true,
  is_system_fallback: false,
  verification_status: 'VERIFIED',
  status: 'ACTIVE',
  created_at: '2026-08-25T04:00:00.000Z',
  updated_at: '2026-08-25T04:10:00.000Z',
};

test('resolveVerifiedDefault queries organization -> tenant -> platform precedence', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [organizationRow], rowCount: 1 });

  const result = await new PostgresCommunicationSenderRepository(client).resolveVerifiedDefault({
    tenantId: organizationRow.tenant_id,
    organizationId: organizationRow.organization_id,
    channel: 'email',
    purpose: 'marketing',
    platformFallback: 'ALLOW',
  });

  assert.equal(result.matchedScope, 'ORGANIZATION');
  assert.deepEqual(result.sender?.scope, {
    kind: 'ORGANIZATION',
    tenantId: organizationRow.tenant_id,
    organizationId: organizationRow.organization_id,
  });
  assert.equal(result.sender?.address, 'hello@example.test');
  assert.equal(result.sender?.displayName, 'Example');
  assert.equal(result.sender?.replyTo, 'reply@example.test');
  assert.deepEqual(client.calls[0]?.values, [
    organizationRow.tenant_id,
    organizationRow.organization_id,
    'email',
    'marketing',
    true,
  ]);
  assert.match(client.calls[0]?.text ?? '', /verification_status = 'VERIFIED'/);
  assert.match(client.calls[0]?.text ?? '', /is_default = true/);
  assert.match(client.calls[0]?.text ?? '', /\$4 = ANY\(purposes\)/);
  assert.match(client.calls[0]?.text ?? '', /WHEN 'ORGANIZATION' THEN 1/);
  assert.match(client.calls[0]?.text ?? '', /WHEN 'TENANT' THEN 2/);
  assert.match(client.calls[0]?.text ?? '', /WHEN 'PLATFORM' THEN 3/);
});

test('DENY platform fallback binds false and platform candidates require system-fallback flag', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresCommunicationSenderRepository(client).resolveVerifiedDefault({
    tenantId: organizationRow.tenant_id,
    channel: 'email',
    purpose: 'marketing',
    platformFallback: 'DENY',
  });

  assert.deepEqual(result, { matchedScope: 'NONE', sender: null });
  assert.equal(client.calls[0]?.values[1], null);
  assert.equal(client.calls[0]?.values[4], false);
  assert.match(client.calls[0]?.text ?? '', /\$5::boolean = true/);
  assert.match(client.calls[0]?.text ?? '', /is_system_fallback = true/);
});

test('maps an allowed platform system fallback without tenant identifiers', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      ...organizationRow,
      scope: 'PLATFORM',
      tenant_id: null,
      organization_id: null,
      address: 'noreply@expadio.test',
      display_name: 'EXPADIO',
      reply_to: null,
      purposes: ['transactional', 'system'],
      is_system_fallback: true,
    }],
    rowCount: 1,
  });

  const result = await new PostgresCommunicationSenderRepository(client).resolveVerifiedDefault({
    tenantId: organizationRow.tenant_id,
    channel: 'email',
    purpose: 'transactional',
    platformFallback: 'ALLOW',
  });

  assert.equal(result.matchedScope, 'PLATFORM');
  assert.deepEqual(result.sender?.scope, { kind: 'PLATFORM' });
  assert.equal(result.sender?.isSystemFallback, true);
  assert.equal(result.sender?.replyTo, undefined);
});

test('returns NONE when no verified active default sender matches', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresCommunicationSenderRepository(client).resolveVerifiedDefault({
    tenantId: organizationRow.tenant_id,
    channel: 'sms',
    purpose: 'transactional',
    platformFallback: 'ALLOW',
  });

  assert.deepEqual(result, { matchedScope: 'NONE', sender: null });
});
