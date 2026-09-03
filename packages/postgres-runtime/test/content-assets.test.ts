import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { registerContentAsset, transitionContentAsset } from '../src/content-assets.ts';

const tenantId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const organizationId = 'c56a4180-65aa-42ec-a945-5fd21dec0539';
const assetId = 'c56a4180-65aa-42ec-a945-5fd21dec0540';
const row = (state = 'PENDING_UPLOAD') => ({
  asset_id: assetId,
  tenant_id: tenantId,
  organization_id: organizationId,
  purpose: 'LEARNING_CONTENT',
  filename: 'lesson.pdf',
  content_type: 'application/pdf',
  byte_length: '100',
  sha256: 'a'.repeat(64),
  storage_object_reference: `content-assets/${tenantId}/${organizationId}/${assetId}`,
  state,
});

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  readonly #responses: Array<SqlQueryResult<Record<string, unknown>>>;

  constructor(responses: Array<SqlQueryResult<Record<string, unknown>>>) {
    this.#responses = responses;
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.#responses.shift();
    if (!response) throw new Error('UNEXPECTED_QUERY');
    return response as SqlQueryResult<Row>;
  }
}

const input = {
  tenantId,
  organizationId,
  requestedBySubjectId: 'user_admin',
  purpose: 'LEARNING_CONTENT' as const,
  filename: 'lesson.pdf',
  contentType: 'application/pdf',
  byteLength: 100,
  sha256: 'a'.repeat(64),
  idempotencyKey: 'lesson:v1:file',
  retentionPolicy: { key: 'learning.standard', version: 1 },
  requiredResidencyTags: ['ca'],
  requiredComplianceTags: [],
  correlationId: 'course:v1',
};

test('registration creates an opaque scope-bound object identity', async () => {
  const client = new ScriptedClient([{ rows: [row()], rowCount: 1 }]);
  const result = await registerContentAsset(client, input);
  assert.equal(result.idempotent, false);
  assert.equal(result.storageObjectReference, `content-assets/${tenantId}/${organizationId}/${assetId}`);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
  assert.doesNotMatch(client.calls[0]?.text ?? '', /public_url|credential|bucket/);
});

test('registration replay returns the existing matching asset', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: 0 },
    { rows: [row()], rowCount: 1 },
  ]);
  const result = await registerContentAsset(client, input);
  assert.equal(result.idempotent, true);
});

test('registration replay rejects a mismatched fingerprint', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: 0 },
    { rows: [{ ...row(), sha256: 'b'.repeat(64) }], rowCount: 1 },
  ]);
  await assert.rejects(() => registerContentAsset(client, input), /IDEMPOTENCY_CONFLICT/);
});

test('availability transition locks metadata and appends lifecycle evidence', async () => {
  const client = new ScriptedClient([
    { rows: [row('QUARANTINED')], rowCount: 1 },
    { rows: [row('AVAILABLE')], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const result = await transitionContentAsset(client, {
    tenantId,
    assetId,
    toState: 'AVAILABLE',
    reasonKey: 'MALWARE_SCAN_CLEAN',
    actorSubjectId: 'worker_scanner',
    correlationId: 'scan:123',
  });
  assert.equal(result.state, 'AVAILABLE');
  assert.match(client.calls[0]?.text ?? '', /FOR UPDATE/);
  assert.match(client.calls[2]?.text ?? '', /content_asset_events/);
});

test('runtime refuses direct pending-to-available transition', async () => {
  const client = new ScriptedClient([{ rows: [row('PENDING_UPLOAD')], rowCount: 1 }]);
  await assert.rejects(
    () => transitionContentAsset(client, {
      tenantId,
      assetId,
      toState: 'AVAILABLE',
      reasonKey: 'UNVERIFIED',
      actorSubjectId: 'user_admin',
      correlationId: 'attempt',
    }),
    /cannot transition/,
  );
  assert.equal(client.calls.length, 1);
});
