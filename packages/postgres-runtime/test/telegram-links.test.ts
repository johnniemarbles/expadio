import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  linkTelegramUser,
  PostgresTelegramChatResolver,
  PostgresTelegramLinkResolver,
} from '../src/telegram-links.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    return step as SqlQueryResult<Row>;
  }
}

test('linkTelegramUser issues an insert-or-update on telegram_user_id conflict', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  await linkTelegramUser(client, { telegramUserId: 12345, tenantId: 'tenant-1', subjectId: 'sub-1' });

  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.telegram_user_links/);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(telegram_user_id\)/);
  assert.deepEqual(client.calls[0]?.values, [12345, 'tenant-1', 'sub-1']);
});

test('PostgresTelegramLinkResolver resolves the linked tenant and subject', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ tenant_id: 'tenant-1', subject_id: 'sub-1' }], rowCount: 1 });
  const resolver = new PostgresTelegramLinkResolver(client);

  const link = await resolver.resolveSubject(12345);

  assert.deepEqual(link, { tenantId: 'tenant-1', subjectId: 'sub-1' });
  assert.deepEqual(client.calls[0]?.values, [12345]);
});

test('PostgresTelegramLinkResolver returns null for an unlinked telegram user', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  const resolver = new PostgresTelegramLinkResolver(client);

  assert.equal(await resolver.resolveSubject(99999), null);
});

test('PostgresTelegramChatResolver resolves the chat id (telegram_user_id) for a linked subject', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ telegram_user_id: 12345 }], rowCount: 1 });
  const resolver = new PostgresTelegramChatResolver(client);

  const chatId = await resolver.resolveChatId('tenant-1', 'sub-1');

  assert.equal(chatId, '12345');
  assert.deepEqual(client.calls[0]?.values, ['tenant-1', 'sub-1']);
});

test('PostgresTelegramChatResolver returns null when the subject has no linked telegram account', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  const resolver = new PostgresTelegramChatResolver(client);

  assert.equal(await resolver.resolveChatId('tenant-1', 'sub-unlinked'), null);
});
