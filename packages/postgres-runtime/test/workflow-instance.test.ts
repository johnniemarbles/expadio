import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresWorkflowInstanceRepository } from '../src/workflow-instance.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import type { WorkflowInstance, WorkflowInstanceCommit } from '@expadio/workflow';

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

const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: 'partner-onboarding',
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: 'partner-onboarding', version: 2, scope: 'TENANT' },
  state: 'RUNNING',
  currentStageKey: 'review',
  revision: 1,
  createdAt: '2026-08-25T07:00:00.000Z',
  startedAt: '2026-08-25T07:00:05.000Z',
  updatedAt: '2026-08-25T07:05:00.000Z',
};

const row = {
  instance_id: instance.instanceId,
  tenant_id: instance.tenantId,
  work_type_key: instance.workTypeKey,
  subject_type: instance.subject.type,
  subject_id: instance.subject.id,
  blueprint_key: instance.blueprint.blueprintKey,
  blueprint_version: instance.blueprint.version,
  blueprint_scope: instance.blueprint.scope,
  state: instance.state,
  current_stage_key: instance.currentStageKey,
  revision: instance.revision,
  created_at: instance.createdAt,
  started_at: instance.startedAt,
  completed_at: null,
  updated_at: instance.updatedAt,
};

test('create persists and maps the workflow instance snapshot', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowInstanceRepository(client).create(instance);

  assert.deepEqual(result, instance);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.workflow_instances/);
  assert.equal(client.calls[0]?.values[0], instance.instanceId);
  assert.equal(client.calls[0]?.values[7], 'TENANT');
});

test('findById scopes the lookup by tenant and instance', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowInstanceRepository(client).findById({
    tenantId: instance.tenantId,
    instanceId: instance.instanceId,
  });

  assert.deepEqual(result, instance);
  assert.deepEqual(client.calls[0]?.values, [instance.tenantId, instance.instanceId]);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
});

test('commitTransition uses one atomic SQL statement and maps committed instance', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [{ commit_status: 'COMMITTED', ...row }], rowCount: 1 });

  const commit: WorkflowInstanceCommit = {
    expectedRevision: 0,
    instance,
    transition: {
      instanceId: instance.instanceId,
      fromStageKey: 'qualification',
      toStageKey: 'review',
      fromState: 'RUNNING',
      toState: 'RUNNING',
      revision: 1,
      transitionedBySubjectId: 'subject-1',
      transitionedAt: instance.updatedAt,
      reason: 'qualified',
    },
  };

  const result = await new PostgresWorkflowInstanceRepository(client).commitTransition(commit);

  assert.deepEqual(result, { committed: true, instance });
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0]?.text ?? '', /WITH current_row AS/);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.workflow_instance_transitions/);
  assert.equal(client.calls[0]?.values[2], 0);
  assert.equal(client.calls[0]?.values[20], 1);
});

test('commitTransition reports revision conflict without appending', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [{ commit_status: 'REVISION_CONFLICT' }], rowCount: 1 });

  const result = await new PostgresWorkflowInstanceRepository(client).commitTransition({
    expectedRevision: 0,
    instance,
    transition: {
      instanceId: instance.instanceId,
      toStageKey: 'review',
      fromState: 'RUNNING',
      toState: 'RUNNING',
      revision: 1,
      transitionedBySubjectId: 'subject-1',
      transitionedAt: instance.updatedAt,
    },
  });

  assert.deepEqual(result, { committed: false, reason: 'REVISION_CONFLICT' });
});

test('commitTransition reports missing instance distinctly', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [{ commit_status: 'INSTANCE_NOT_FOUND' }], rowCount: 1 });

  const result = await new PostgresWorkflowInstanceRepository(client).commitTransition({
    expectedRevision: 0,
    instance,
    transition: {
      instanceId: instance.instanceId,
      toStageKey: 'review',
      fromState: 'RUNNING',
      toState: 'RUNNING',
      revision: 1,
      transitionedBySubjectId: 'subject-1',
      transitionedAt: instance.updatedAt,
    },
  });

  assert.deepEqual(result, { committed: false, reason: 'INSTANCE_NOT_FOUND' });
});
