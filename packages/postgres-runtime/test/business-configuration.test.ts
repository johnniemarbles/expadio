import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BusinessConfigurationPublication,
} from '@expadio/business-config';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresBusinessConfigurationPublicationRepository } from '../src/business-configuration.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];
  async query<Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const publication: BusinessConfigurationPublication = {
  changesetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  scope: { kind: 'TENANT', tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
  baseRevision: 0,
  revision: 1,
  objects: [{
    kind: 'TERMINOLOGY',
    key: 'customer-labels',
    version: 1,
    scope: { kind: 'TENANT', tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    label: 'Customer labels',
    state: 'PUBLISHED',
    payload: { customer: 'Client' },
    dependencies: [],
    authoredBySubjectId: 'author-1',
    authoredAt: '2026-08-25T14:00:00.000Z',
  }],
  publishedBySubjectId: 'publisher-1',
  publishedAt: '2026-08-25T14:30:00.000Z',
  reason: 'Publish labels.',
  evidenceRefs: ['ticket:1'],
};

test('lists platform plus matching scope identities', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ kind: 'POLICY', object_key: 'limits', version: 1 }], rowCount: 1 });
  const result = await new PostgresBusinessConfigurationPublicationRepository(client)
    .listAvailableIdentities(publication.scope);
  assert.deepEqual(result, [{ kind: 'POLICY', key: 'limits', version: 1 }]);
  assert.deepEqual(client.calls[0]?.values, ['TENANT', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  assert.match(client.calls[0]?.text ?? '', /scope_kind = 'PLATFORM'/);
});

test('publishes header and objects in one atomic SQL statement', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });
  const result = await new PostgresBusinessConfigurationPublicationRepository(client)
    .publish(publication);
  assert.equal(result.status, 'COMMITTED');
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0]?.text ?? '', /WITH inserted_publication AS/);
  assert.match(client.calls[0]?.text ?? '', /jsonb_to_recordset/);
  assert.equal(client.calls[0]?.values[3], 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
});

test('maps stale revision errors without retrying the write', async () => {
  const client = new Client();
  client.steps.push(Object.assign(new Error('stale'), { code: '40001' }));
  client.steps.push({ rows: [{ revision: 4 }], rowCount: 1 });
  const result = await new PostgresBusinessConfigurationPublicationRepository(client)
    .publish(publication);
  assert.deepEqual(result, { status: 'REVISION_CONFLICT', currentRevision: 4 });
  assert.equal(client.calls.length, 2);
});

test('maps exact concurrent publication retries', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({
    rows: [{
      changeset_id: publication.changesetId,
      scope_kind: 'TENANT',
      scope_key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      base_revision: 0,
      revision: 1,
      published_by_subject_id: publication.publishedBySubjectId,
      published_at: publication.publishedAt,
      reason: publication.reason,
      evidence_refs: publication.evidenceRefs,
    }],
    rowCount: 1,
  });
  client.steps.push({
    rows: [{
      kind: 'TERMINOLOGY',
      object_key: 'customer-labels',
      version: 1,
      label: 'Customer labels',
      payload: { customer: 'Client' },
      dependencies: [],
      authored_by_subject_id: 'author-1',
      authored_at: '2026-08-25T14:00:00.000Z',
    }],
    rowCount: 1,
  });
  const result = await new PostgresBusinessConfigurationPublicationRepository(client)
    .publish(publication);
  assert.equal(result.status, 'ALREADY_COMMITTED');
});
