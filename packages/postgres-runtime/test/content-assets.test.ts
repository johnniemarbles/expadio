import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  issueContentAssetReadGrant,
  registerContentAsset,
  quarantineContentAssetForScan,
  resolveQuarantinedContentAssetScan,
  transitionContentAsset,
  uploadContentAsset,
} from '../src/content-assets.ts';
import type { ContentAssetBinaryStore, ContentAssetScanner } from '@expadio/storage';

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

test('upload advances state only after provider verification', async () => {
  const transferRow = {
    ...row('PENDING_UPLOAD'),
    retention_policy_key: 'learning.standard',
    retention_policy_version: 1,
    required_residency_tags: ['ca'],
    required_compliance_tags: [],
    correlation_id: 'course:v1',
  };
  const client = new ScriptedClient([
    { rows: [transferRow], rowCount: 1 },
    { rows: [row('PENDING_UPLOAD')], rowCount: 1 },
    { rows: [row('UPLOADED')], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const binaryStore: ContentAssetBinaryStore = {
    store: async (request) => ({
      objectReference: request.objectReference,
      providerReference: 'private-provider-reference',
      byteLength: request.expectedByteLength,
      sha256: request.expectedSha256,
      storedAt: '2026-09-03T09:00:00.000Z',
    }),
    issueReadGrant: async () => { throw new Error('UNUSED'); },
  };
  const result = await uploadContentAsset(client, binaryStore, {
    tenantId,
    assetId,
    content: new Uint8Array(100),
    actorSubjectId: 'user_admin',
    correlationId: 'upload:1',
  });
  assert.equal(result.state, 'UPLOADED');
  assert.match(client.calls[0]?.text ?? '', /FOR UPDATE/);
  assert.match(client.calls[3]?.text ?? '', /content_asset_events/);
});

test('read grants require AVAILABLE metadata and append access evidence', async () => {
  const transferRow = {
    ...row('AVAILABLE'),
    retention_policy_key: 'learning.standard',
    retention_policy_version: 1,
    required_residency_tags: ['ca'],
    required_compliance_tags: [],
    correlation_id: 'course:v1',
  };
  const client = new ScriptedClient([
    { rows: [transferRow], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const binaryStore: ContentAssetBinaryStore = {
    store: async () => { throw new Error('UNUSED'); },
    issueReadGrant: async (request) => ({
      url: 'https://project.supabase.co/storage/v1/signed',
      expiresAt: '2026-09-03T09:01:00.000Z',
      objectReference: request.objectReference,
    }),
  };
  const grant = await issueContentAssetReadGrant(client, binaryStore, {
    tenantId,
    assetId,
    purpose: 'learning.player',
    actorSubjectId: 'learner_1',
    correlationId: 'read:1',
  });
  assert.match(grant.url, /^https:/);
  assert.match(client.calls[0]?.text ?? '', /state = 'AVAILABLE'/);
  assert.match(client.calls[1]?.text ?? '', /READ_GRANT_ISSUED/);
});

test('read grants fail closed when asset is not available', async () => {
  const client = new ScriptedClient([{ rows: [], rowCount: 0 }]);
  const binaryStore: ContentAssetBinaryStore = {
    store: async () => { throw new Error('UNUSED'); },
    issueReadGrant: async () => { throw new Error('MUST_NOT_RUN'); },
  };
  await assert.rejects(
    () => issueContentAssetReadGrant(client, binaryStore, {
      tenantId,
      assetId,
      purpose: 'learning.player',
      actorSubjectId: 'learner_1',
      correlationId: 'read:blocked',
    }),
    /NOT_AVAILABLE/,
  );
});


const quarantinedRow = () => ({
  ...row('QUARANTINED'),
  retention_policy_key: 'learning.standard',
  retention_policy_version: 1,
  required_residency_tags: ['ca'],
  required_compliance_tags: [],
  correlation_id: 'course:v1',
});

test('uploaded assets enter quarantine before scanning', async () => {
  const client = new ScriptedClient([
    { rows: [row('UPLOADED')], rowCount: 1 },
    { rows: [row('QUARANTINED')], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const result = await quarantineContentAssetForScan(client, {
    tenantId,
    assetId,
    actorSubjectId: 'worker_scanner',
    correlationId: 'scan:queue:1',
  });
  assert.equal(result.state, 'QUARANTINED');
  assert.match(client.calls[2]?.text ?? '', /MALWARE_SCAN_REQUIRED|content_asset_events/);
});

test('clean scan releases a quarantined asset with lifecycle evidence', async () => {
  const client = new ScriptedClient([
    { rows: [quarantinedRow()], rowCount: 1 },
    { rows: [row('QUARANTINED')], rowCount: 1 },
    { rows: [row('AVAILABLE')], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const scanner: ContentAssetScanner = {
    scan: async (scanInput) => ({
      assetId: scanInput.assetId,
      objectReference: scanInput.objectReference,
      sha256: scanInput.sha256,
      verdict: 'CLEAN',
      reasonKey: 'NO_THREATS_FOUND',
      engine: 'clamav',
      engineVersion: '1.4.3',
      signatureVersion: '20260903',
      scannedAt: '2026-09-03T10:00:00.000Z',
    }),
  };
  const result = await resolveQuarantinedContentAssetScan(client, scanner, {
    tenantId,
    assetId,
    actorSubjectId: 'worker_scanner',
    correlationId: 'scan:1',
  });
  assert.equal(result.asset.state, 'AVAILABLE');
  assert.equal(result.scan.verdict, 'CLEAN');
  assert.match(client.calls[0]?.text ?? '', /state = 'QUARANTINED'[\s\S]*FOR UPDATE/);
  assert.match(String(client.calls[3]?.values?.[5]), /MALWARE_SCAN_CLEAN/);
});

test('malicious scan rejects the asset and an indeterminate scan stays quarantined', async () => {
  const maliciousClient = new ScriptedClient([
    { rows: [quarantinedRow()], rowCount: 1 },
    { rows: [row('QUARANTINED')], rowCount: 1 },
    { rows: [row('REJECTED')], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const malicious: ContentAssetScanner = {
    scan: async (scanInput) => ({
      assetId: scanInput.assetId,
      objectReference: scanInput.objectReference,
      sha256: scanInput.sha256,
      verdict: 'MALICIOUS',
      reasonKey: 'EICAR_TEST_SIGNATURE',
      engine: 'clamav',
      engineVersion: '1.4.3',
      signatureVersion: '20260903',
      scannedAt: '2026-09-03T10:00:00.000Z',
    }),
  };
  const rejected = await resolveQuarantinedContentAssetScan(maliciousClient, malicious, {
    tenantId,
    assetId,
    actorSubjectId: 'worker_scanner',
    correlationId: 'scan:2',
  });
  assert.equal(rejected.asset.state, 'REJECTED');

  const indeterminateClient = new ScriptedClient([
    { rows: [quarantinedRow()], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const indeterminate: ContentAssetScanner = {
    scan: async (scanInput) => ({
      assetId: scanInput.assetId,
      objectReference: scanInput.objectReference,
      sha256: scanInput.sha256,
      verdict: 'INDETERMINATE',
      reasonKey: 'ENGINE_TIMEOUT',
      engine: 'clamav',
      engineVersion: '1.4.3',
      signatureVersion: '20260903',
      scannedAt: '2026-09-03T10:00:00.000Z',
    }),
  };
  const held = await resolveQuarantinedContentAssetScan(indeterminateClient, indeterminate, {
    tenantId,
    assetId,
    actorSubjectId: 'worker_scanner',
    correlationId: 'scan:3',
  });
  assert.equal(held.asset.state, 'QUARANTINED');
  assert.equal(held.asset.idempotent, true);
  assert.match(indeterminateClient.calls[1]?.text ?? '', /content_asset_events/);
  assert.match(String(indeterminateClient.calls[1]?.values?.[4]), /MALWARE_SCAN_INDETERMINATE/);
});

test('scanner failure cannot publish a quarantined asset', async () => {
  const client = new ScriptedClient([{ rows: [quarantinedRow()], rowCount: 1 }]);
  const scanner: ContentAssetScanner = {
    scan: async () => { throw new Error('SCANNER_UNAVAILABLE'); },
  };
  await assert.rejects(
    () => resolveQuarantinedContentAssetScan(client, scanner, {
      tenantId,
      assetId,
      actorSubjectId: 'worker_scanner',
      correlationId: 'scan:failed',
    }),
    /SCANNER_UNAVAILABLE/,
  );
  assert.equal(client.calls.length, 1);
});
