import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowActivationRecord } from '@expadio/workflow';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresWorkflowActivationRepository } from '../src/workflow-activation.ts';

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

const activation: WorkflowActivationRecord = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  activationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  blueprintKey: 'partner-activation',
  blueprintVersion: 3,
  provisioningModel: 'SCOPED_WORKSPACE',
  sourceRightsGrantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
  verificationState: 'NOT_VERIFIED',
  provisionedResourceRefs: [],
  startedAt: '2026-08-25T09:00:00.000Z',
  verificationEvidenceRefs: ['decision:decision-1'],
};

const row = {
  activation_id: activation.activationId,
  tenant_id: activation.tenantId,
  instance_id: activation.instanceId,
  work_type_key: activation.workTypeKey,
  blueprint_key: activation.blueprintKey,
  blueprint_version: activation.blueprintVersion,
  provisioning_model: activation.provisioningModel,
  source_rights_grant_ids: activation.sourceRightsGrantIds,
  verification_state: activation.verificationState,
  provisioned_resource_refs: activation.provisionedResourceRefs,
  started_at: activation.startedAt,
  completed_at: null,
  verified_by_subject_id: null,
  verified_at: null,
  verification_evidence_refs: activation.verificationEvidenceRefs,
};

test('find resolves one tenant-scoped immutable activation', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationRepository(client).find({
    tenantId: activation.tenantId,
    activationId: activation.activationId,
  });

  assert.deepEqual(result, activation);
  assert.deepEqual(client.calls[0]?.values, [
    activation.tenantId,
    activation.activationId,
  ]);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[0]?.text ?? '', /activation_id = \$2::uuid/);
});

test('record returns COMMITTED for a newly inserted activation', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationRepository(client)
    .record(activation);

  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(result.activation, activation);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT DO NOTHING/);
  assert.deepEqual(client.calls[0]?.values[7], activation.sourceRightsGrantIds);
});

test('record maps an exact immutable retry to ALREADY_RECORDED', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationRepository(client)
    .record(activation);

  assert.equal(result.status, 'ALREADY_RECORDED');
  assert.deepEqual(result.activation, activation);
  assert.equal(client.calls.length, 2);
});

test('record returns CONFLICT when immutable content differs', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({
    rows: [{ ...row, provisioning_model: 'ACCOUNT_ONLY' }],
    rowCount: 1,
  });

  const result = await new PostgresWorkflowActivationRepository(client)
    .record(activation);

  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.existing.provisioningModel, 'ACCOUNT_ONLY');
});
