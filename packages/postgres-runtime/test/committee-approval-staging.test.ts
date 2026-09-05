import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { CommitteeApprovalStagingError, stageCommitteeOutputForApproval } from '../src/committee-approval-staging.ts';

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

const baseInput = {
  tenantId: 'tenant-1',
  taskId: 'task-1',
  organizationId: 'org-1',
  proposerSubjectId: 'sub-proposer',
};

function completedTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    mission_id: 'mission-1',
    title: 'Publish campaign',
    description: 'Editorial committee draft',
    status: 'COMPLETED',
    output_artifact: { observation: { outputReference: 'memory://editorial-debate:exec-1' } },
    ...overrides,
  };
}

function queueSuccessfulStaging(client: Client, options: { policyApplied?: string } = {}) {
  client.steps.push({ rows: [completedTaskRow()], rowCount: 1 }); // task lookup
  client.steps.push({
    rows: [{
      tenant_id: 'tenant-1', memory_key: 'editorial-debate:exec-1',
      memory_value: { fullCopy: 'Draft copy', consensusScore: 9.4 }, metadata: {},
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }],
    rowCount: 1,
  }); // memory lookup
  client.steps.push({ rows: [{ node_id: 'brand-hq' }], rowCount: 1 }); // node resolution
  client.steps.push({ rows: [{ resolve_publishing_policy: options.policyApplied ?? 'COUNTRY_BRAND_MANDATORY' }], rowCount: 1 }); // policy resolution
  client.steps.push({ rows: [{ governance_root: 'brand-hq' }], rowCount: 1 }); // governanceRoot
  client.steps.push({
    rows: [{
      approval_id: 'approval-1', mission_id: 'mission-1', task_id: 'task-1', tenant_id: 'tenant-1',
      title: 'Publish campaign', description: 'Editorial committee draft',
      staged_changes: { fullCopy: 'Draft copy', consensusScore: 9.4 }, status: 'PENDING',
      proposer_subject_id: 'sub-proposer', approver_subject_id: null,
      target_approver_node_id: 'brand-hq', policy_applied: 'COUNTRY_BRAND_MANDATORY',
      telegram_message_id: null, created_at: '2026-01-01T00:00:00.000Z', resolved_at: null,
    }],
    rowCount: 1,
  }); // createAgentApprovalRequest
}

test('stages a completed committee task\'s actual output as a real approval, routed to the governance root', async () => {
  const client = new Client();
  queueSuccessfulStaging(client);

  const result = await stageCommitteeOutputForApproval(client, baseInput);

  assert.equal(result.approvalId, 'approval-1');
  assert.equal(result.targetApproverNodeId, 'brand-hq');
  assert.equal(result.policyApplied, 'COUNTRY_BRAND_MANDATORY');

  // The staged content must be the committee's actual drafted output, not
  // the task's input payload -- confirm the final insert's stagedChanges
  // value came from the memory record, not from the task row.
  const insertCall = client.calls.at(-1);
  assert.match(insertCall?.text ?? '', /INSERT INTO platform\.agent_approval_requests/);
  assert.equal(insertCall?.values[6], JSON.stringify({ fullCopy: 'Draft copy', consensusScore: 9.4 }));
  assert.equal(insertCall?.values[8], 'brand-hq');
  assert.equal(insertCall?.values[9], 'COUNTRY_BRAND_MANDATORY');
});

test('throws when the task does not exist', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });

  await assert.rejects(
    () => stageCommitteeOutputForApproval(client, baseInput),
    (err: unknown) => err instanceof CommitteeApprovalStagingError && err.code === 'COMMITTEE_TASK_NOT_FOUND',
  );
});

test('throws when the task has not completed yet', async () => {
  const client = new Client();
  client.steps.push({ rows: [completedTaskRow({ status: 'RUNNING' })], rowCount: 1 });

  await assert.rejects(
    () => stageCommitteeOutputForApproval(client, baseInput),
    (err: unknown) => err instanceof CommitteeApprovalStagingError && err.code === 'COMMITTEE_TASK_NOT_COMPLETED',
  );
});

test('throws when the task has no output reference to stage', async () => {
  const client = new Client();
  client.steps.push({ rows: [completedTaskRow({ output_artifact: { summary: 'no observation here' } })], rowCount: 1 });

  await assert.rejects(
    () => stageCommitteeOutputForApproval(client, baseInput),
    (err: unknown) => err instanceof CommitteeApprovalStagingError && err.code === 'COMMITTEE_OUTPUT_REFERENCE_INVALID',
  );
});

test('throws when the output reference is not a memory:// reference', async () => {
  const client = new Client();
  client.steps.push({
    rows: [completedTaskRow({ output_artifact: { observation: { outputReference: 'artifact:cbos:context:tenant-1:exec-1' } } })],
    rowCount: 1,
  });

  await assert.rejects(
    () => stageCommitteeOutputForApproval(client, baseInput),
    (err: unknown) => err instanceof CommitteeApprovalStagingError && err.code === 'COMMITTEE_OUTPUT_REFERENCE_INVALID',
  );
});

test('throws when the referenced artifact cannot be found', async () => {
  const client = new Client();
  client.steps.push({ rows: [completedTaskRow()], rowCount: 1 });
  client.steps.push({ rows: [], rowCount: 0 }); // memory lookup misses

  await assert.rejects(
    () => stageCommitteeOutputForApproval(client, baseInput),
    (err: unknown) => err instanceof CommitteeApprovalStagingError && err.code === 'COMMITTEE_OUTPUT_NOT_FOUND',
  );
});

test('throws when no entity node is linked to the caller\'s organization', async () => {
  const client = new Client();
  client.steps.push({ rows: [completedTaskRow()], rowCount: 1 });
  client.steps.push({
    rows: [{ tenant_id: 'tenant-1', memory_key: 'k', memory_value: {}, metadata: {}, created_at: '', updated_at: '' }],
    rowCount: 1,
  });
  client.steps.push({ rows: [], rowCount: 0 }); // no linked node

  await assert.rejects(
    () => stageCommitteeOutputForApproval(client, baseInput),
    (err: unknown) => err instanceof CommitteeApprovalStagingError && err.code === 'COMMITTEE_INITIATING_NODE_UNRESOLVED',
  );
});

test('routes to the territorial authority under STATE_MASTER_SIGN_OFF instead of the governance root', async () => {
  const client = new Client();
  client.steps.push({ rows: [completedTaskRow()], rowCount: 1 });
  client.steps.push({
    rows: [{ tenant_id: 'tenant-1', memory_key: 'k', memory_value: { fullCopy: 'x' }, metadata: {}, created_at: '', updated_at: '' }],
    rowCount: 1,
  });
  client.steps.push({ rows: [{ node_id: 'unit-1' }], rowCount: 1 });
  client.steps.push({ rows: [{ resolve_publishing_policy: 'STATE_MASTER_SIGN_OFF' }], rowCount: 1 });
  client.steps.push({ rows: [{ territorial_authority: 'state-master-ontario' }], rowCount: 1 });
  client.steps.push({
    rows: [{
      approval_id: 'approval-2', mission_id: 'mission-1', task_id: 'task-1', tenant_id: 'tenant-1',
      title: 'x', description: 'x', staged_changes: {}, status: 'PENDING',
      proposer_subject_id: 'sub-proposer', approver_subject_id: null,
      target_approver_node_id: 'state-master-ontario', policy_applied: 'STATE_MASTER_SIGN_OFF',
      telegram_message_id: null, created_at: '', resolved_at: null,
    }],
    rowCount: 1,
  });

  const result = await stageCommitteeOutputForApproval(client, baseInput);

  assert.equal(result.targetApproverNodeId, 'state-master-ontario');
  assert.equal(result.policyApplied, 'STATE_MASTER_SIGN_OFF');
});
