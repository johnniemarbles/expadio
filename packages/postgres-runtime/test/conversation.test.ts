import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresConversationRepository } from '../src/conversation.ts';
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

const conversationRow = {
  conversation_id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: '22222222-2222-2222-2222-222222222222',
  subject_id: 'subject-1',
  channel: 'whatsapp',
  status: 'OPEN',
  owner_type: 'HUMAN',
  owner_id: 'user-1',
};

test('create persists one conversation and deduplicated generic context inside caller transaction', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [conversationRow], rowCount: 1 });
  client.responses.push({ rows: [], rowCount: 1 });

  const repository = new PostgresConversationRepository(client);
  const created = await repository.create({
    tenantId: conversationRow.tenant_id,
    organizationId: conversationRow.organization_id,
    subjectId: 'subject-1',
    channel: 'whatsapp',
    ownership: { ownerType: 'HUMAN', ownerId: 'user-1' },
    context: [
      { kind: ' lead ', id: 'lead-1' },
      { kind: 'lead', id: 'lead-1' },
    ],
  });

  assert.equal(created.conversationId, conversationRow.conversation_id);
  assert.deepEqual(created.context, [{ kind: 'lead', id: 'lead-1' }]);
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[0]?.text ?? '', /communication_conversations/);
  assert.match(client.calls[1]?.text ?? '', /communication_conversation_context/);
  assert.deepEqual(client.calls[1]?.values, [
    conversationRow.conversation_id,
    conversationRow.tenant_id,
    'lead',
    'lead-1',
  ]);
});

test('load is explicitly tenant-bound and maps generic context', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [conversationRow], rowCount: 1 });
  client.responses.push({
    rows: [{ context_kind: 'case', context_id: 'case-9' }],
    rowCount: 1,
  });

  const loaded = await new PostgresConversationRepository(client).load(
    conversationRow.tenant_id,
    conversationRow.conversation_id,
  );

  assert.equal(loaded?.tenantId, conversationRow.tenant_id);
  assert.deepEqual(loaded?.context, [{ kind: 'case', id: 'case-9' }]);
  assert.deepEqual(client.calls[0]?.values, [conversationRow.tenant_id, conversationRow.conversation_id]);
  assert.deepEqual(client.calls[1]?.values, [conversationRow.tenant_id, conversationRow.conversation_id]);
});

test('append message stores provider-neutral references and returns normalized timestamp', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      message_id: '33333333-3333-3333-3333-333333333333',
      occurred_at: '2026-08-25T03:00:00.000Z',
    }],
    rowCount: 1,
  });

  const appended = await new PostgresConversationRepository(client).appendMessage({
    tenantId: conversationRow.tenant_id,
    conversationId: conversationRow.conversation_id,
    channel: 'voice',
    direction: 'OUTBOUND',
    senderType: 'AI',
    senderId: 'agent-1',
    communicationMessageId: 'comms-1',
    providerMessageId: 'provider-1',
    payload: { transcriptState: 'partial' },
  });

  assert.deepEqual(appended, {
    messageId: '33333333-3333-3333-3333-333333333333',
    occurredAt: '2026-08-25T03:00:00.000Z',
  });
  assert.equal(client.calls[0]?.values[0], conversationRow.conversation_id);
  assert.equal(client.calls[0]?.values[1], conversationRow.tenant_id);
  assert.equal(client.calls[0]?.values[9], JSON.stringify({ transcriptState: 'partial' }));
});

test('handoff updates ownership within tenant boundary then reloads snapshot', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 1 });
  client.responses.push({
    rows: [{ ...conversationRow, owner_type: 'AI', owner_id: 'agent-2' }],
    rowCount: 1,
  });
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresConversationRepository(client).handoff({
    tenantId: conversationRow.tenant_id,
    conversationId: conversationRow.conversation_id,
    ownership: { ownerType: 'AI', ownerId: 'agent-2' },
  });

  assert.deepEqual(result.ownership, { ownerType: 'AI', ownerId: 'agent-2' });
  assert.match(client.calls[0]?.text ?? '', /WHERE tenant_id = \$1::uuid AND conversation_id = \$2::uuid/);
});
