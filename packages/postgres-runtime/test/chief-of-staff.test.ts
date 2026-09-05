import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  createAgentApprovalRequest,
  getAgentApprovalRequest,
  resolveAgentApproval,
} from '../src/chief-of-staff.ts';

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

function approvalRow(overrides: Record<string, unknown> = {}) {
  return {
    approval_id: 'approval-1',
    mission_id: 'mission-1',
    task_id: 'task-1',
    tenant_id: 'tenant-1',
    title: 'Publish campaign',
    description: '',
    staged_changes: {},
    status: 'PENDING',
    proposer_subject_id: 'sub-proposer',
    approver_subject_id: null,
    telegram_message_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

test('createAgentApprovalRequest persists and returns the proposer subject id', async () => {
  const client = new Client();
  client.steps.push({ rows: [approvalRow()], rowCount: 1 });

  const result = await createAgentApprovalRequest(client, {
    missionId: 'mission-1',
    taskId: 'task-1',
    tenantId: 'tenant-1',
    title: 'Publish campaign',
    proposerSubjectId: 'sub-proposer',
  });

  assert.equal(result.proposerSubjectId, 'sub-proposer');
  assert.equal(result.approverSubjectId, null);
  assert.match(client.calls[0]?.text ?? '', /proposer_subject_id/);
  assert.equal(client.calls[0]?.values[7], 'sub-proposer');
});

test('getAgentApprovalRequest maps proposer and approver subject ids', async () => {
  const client = new Client();
  client.steps.push({
    rows: [approvalRow({ status: 'APPROVED', approver_subject_id: 'sub-approver' })],
    rowCount: 1,
  });

  const result = await getAgentApprovalRequest(client, 'approval-1', 'tenant-1');

  assert.equal(result?.proposerSubjectId, 'sub-proposer');
  assert.equal(result?.approverSubjectId, 'sub-approver');
});

test('getAgentApprovalRequest returns null when no row matches', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });

  const result = await getAgentApprovalRequest(client, 'missing', 'tenant-1');

  assert.equal(result, null);
});

test('resolveAgentApproval records the approver and excludes the proposer at the SQL layer', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        task_id: 'task-1',
        mission_id: 'mission-1',
        tenant_id: 'tenant-1',
        assigned_agent_id: 'agent-1',
        title: 'Publish campaign',
        description: '',
        action_payload: {},
        depends_on: [],
        requires_approval: true,
        status: 'QUEUED',
        output_artifact: null,
        error: null,
        started_at: null,
        completed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    rowCount: 1,
  });

  const task = await resolveAgentApproval(client, {
    approvalId: 'approval-1',
    missionId: 'mission-1',
    tenantId: 'tenant-1',
    approved: true,
    approverSubjectId: 'sub-approver',
  });

  assert.equal(task?.status, 'QUEUED');
  const [query, values] = [client.calls[0]?.text ?? '', client.calls[0]?.values ?? []];
  // The self-approval guard must be enforced in SQL too, not only in the
  // orchestrator, so a caller that bypasses ChiefOfStaffOrchestrator cannot
  // silently let a proposer approve their own action.
  assert.match(query, /proposer_subject_id <> \$2/);
  assert.equal(values[1], 'sub-approver');
});

test('resolveAgentApproval returns null when the approval row was not pending', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });

  const task = await resolveAgentApproval(client, {
    approvalId: 'approval-1',
    missionId: 'mission-1',
    tenantId: 'tenant-1',
    approved: true,
    approverSubjectId: 'sub-approver',
  });

  assert.equal(task, null);
});
