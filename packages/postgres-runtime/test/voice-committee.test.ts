import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresCallbackBriefResolver, VoiceCommitteeReferenceError } from '../src/voice-committee.ts';

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

const validReference = 'ref:task:44444444-4444-4444-4444-444444444444:input';

test('resolves a full callback brief from the task action_payload', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        action_payload: {
          leadName: 'Acme Salons',
          callbackReason: 'Requested pricing',
          brandVoiceGuideline: 'Direct',
          languageTag: 'en-US',
          jurisdictionTags: ['US-CA', 7, 'US-NY'],
        },
      },
    ],
    rowCount: 1,
  });
  const resolver = new PostgresCallbackBriefResolver(client);

  const brief = await resolver.resolveBrief(validReference, 'tenant-1');

  assert.equal(brief.leadName, 'Acme Salons');
  assert.equal(brief.languageTag, 'en-US');
  assert.deepEqual(brief.jurisdictionTags, ['US-CA', 'US-NY']);
  assert.equal(client.calls[0]?.values[0], '44444444-4444-4444-4444-444444444444');
});

test('rejects a reference that does not match the ref:task:<id>:input convention', async () => {
  const client = new Client();
  const resolver = new PostgresCallbackBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief('not-a-reference', 'tenant-1'),
    (err: unknown) => err instanceof VoiceCommitteeReferenceError && err.code === 'VOICE_REFERENCE_INVALID',
  );
  assert.equal(client.calls.length, 0);
});

test('rejects when no task matches the reference', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  const resolver = new PostgresCallbackBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief(validReference, 'tenant-1'),
    (err: unknown) => err instanceof VoiceCommitteeReferenceError && err.code === 'VOICE_TASK_NOT_FOUND',
  );
});

test('rejects when jurisdictionTags is empty, since VoiceGateway requires at least one', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        action_payload: {
          leadName: 'Acme Salons',
          callbackReason: 'Requested pricing',
          brandVoiceGuideline: 'Direct',
          languageTag: 'en-US',
          jurisdictionTags: [],
        },
      },
    ],
    rowCount: 1,
  });
  const resolver = new PostgresCallbackBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief(validReference, 'tenant-1'),
    (err: unknown) => err instanceof VoiceCommitteeReferenceError && err.code === 'VOICE_BRIEF_INCOMPLETE',
  );
});

test('rejects a payload missing other required fields', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ action_payload: { leadName: 'Acme Salons' } }], rowCount: 1 });
  const resolver = new PostgresCallbackBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief(validReference, 'tenant-1'),
    (err: unknown) => err instanceof VoiceCommitteeReferenceError && err.code === 'VOICE_BRIEF_INCOMPLETE',
  );
});
