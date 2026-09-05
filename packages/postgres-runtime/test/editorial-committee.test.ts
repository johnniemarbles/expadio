import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  EditorialBriefResolutionError,
  PostgresTaskActionPayloadBriefResolver,
} from '../src/editorial-committee.ts';

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

const validReference = 'ref:task:11111111-1111-1111-1111-111111111111:input';

test('resolves a brief from the referenced task action_payload', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        action_payload: {
          verticalTheme: 'Salon Expansion',
          brandVoiceGuideline: 'Direct',
          compliancePack: 'FTC Franchise Rules',
        },
      },
    ],
    rowCount: 1,
  });

  const resolver = new PostgresTaskActionPayloadBriefResolver(client);
  const brief = await resolver.resolveBrief(validReference, 'tenant-1');

  assert.deepEqual(brief, {
    verticalTheme: 'Salon Expansion',
    brandVoiceGuideline: 'Direct',
    compliancePack: 'FTC Franchise Rules',
  });
  assert.equal(client.calls[0]?.values[0], '11111111-1111-1111-1111-111111111111');
  assert.equal(client.calls[0]?.values[1], 'tenant-1');
});

test('rejects a reference that does not match the ref:task:<id>:input convention', async () => {
  const client = new Client();
  const resolver = new PostgresTaskActionPayloadBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief('not-a-task-reference', 'tenant-1'),
    (err: unknown) => err instanceof EditorialBriefResolutionError && err.code === 'EDITORIAL_BRIEF_REFERENCE_INVALID',
  );
  assert.equal(client.calls.length, 0);
});

test('rejects when no task matches the reference', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  const resolver = new PostgresTaskActionPayloadBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief(validReference, 'tenant-1'),
    (err: unknown) => err instanceof EditorialBriefResolutionError && err.code === 'EDITORIAL_BRIEF_TASK_NOT_FOUND',
  );
});

test('rejects when the task payload is missing required brief fields', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ action_payload: { verticalTheme: 'Salon Expansion' } }], rowCount: 1 });
  const resolver = new PostgresTaskActionPayloadBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief(validReference, 'tenant-1'),
    (err: unknown) => err instanceof EditorialBriefResolutionError && err.code === 'EDITORIAL_BRIEF_INCOMPLETE',
  );
});
