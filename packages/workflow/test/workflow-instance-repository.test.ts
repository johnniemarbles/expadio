import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowInstance,
  WorkflowInstanceCommit,
  WorkflowInstanceCommitResult,
  WorkflowInstanceRepository,
  WorkflowStageTransitionRecord,
} from '../src/index.ts';

const instance: WorkflowInstance = {
  instanceId: 'instance-1',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: 'partner-onboarding',
  subject: { type: 'lead-case', id: 'case-1' },
  blueprint: { blueprintKey: 'partner-onboarding', version: 7, scope: 'TENANT' },
  state: 'RUNNING',
  currentStageKey: 'review',
  revision: 4,
  createdAt: '2026-08-25T06:00:00.000Z',
  startedAt: '2026-08-25T06:01:00.000Z',
  updatedAt: '2026-08-25T06:06:00.000Z',
};

const transition: WorkflowStageTransitionRecord = {
  instanceId: instance.instanceId,
  fromStageKey: 'qualification',
  toStageKey: 'review',
  fromState: 'RUNNING',
  toState: 'RUNNING',
  revision: 4,
  transitionedBySubjectId: 'user-1',
  transitionedAt: '2026-08-25T06:06:00.000Z',
};

class ContractRepository implements WorkflowInstanceRepository {
  async create(value: WorkflowInstance): Promise<WorkflowInstance> {
    return value;
  }

  async findById(): Promise<WorkflowInstance | null> {
    return instance;
  }

  async commitTransition(commit: WorkflowInstanceCommit): Promise<WorkflowInstanceCommitResult> {
    if (commit.expectedRevision !== 3) {
      return { committed: false, reason: 'REVISION_CONFLICT' };
    }
    return { committed: true, instance: commit.instance };
  }
}

test('workflow instance repository exposes create/load and atomic transition commit boundary', async () => {
  const repository: WorkflowInstanceRepository = new ContractRepository();
  assert.deepEqual(await repository.create(instance), instance);
  assert.deepEqual(await repository.findById({
    tenantId: instance.tenantId,
    instanceId: instance.instanceId,
  }), instance);

  const committed = await repository.commitTransition({
    expectedRevision: 3,
    instance,
    transition,
  });
  assert.deepEqual(committed, { committed: true, instance });
});

test('repository commit result can report optimistic revision conflict without mutation', async () => {
  const repository: WorkflowInstanceRepository = new ContractRepository();
  const result = await repository.commitTransition({
    expectedRevision: 2,
    instance,
    transition,
  });
  assert.deepEqual(result, { committed: false, reason: 'REVISION_CONFLICT' });
});
