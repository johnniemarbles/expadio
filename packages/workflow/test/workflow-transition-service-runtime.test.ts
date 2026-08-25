import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RepositoryWorkflowTransitionService,
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowInstanceCommit,
  type WorkflowInstanceCommitResult,
  type WorkflowInstanceRepository,
  type WorkflowTransitionGateEvaluator,
} from '../src/index.ts';

const stage = (stageKey: string, sequence: number) => ({
  stageKey,
  label: stageKey,
  sequence,
  kind: 'CUSTOM' as const,
  isMandatory: true,
  canBeDeactivated: false,
  isParallel: false,
  requiredParticipantKeys: [],
  decisionRequired: false,
  decisionOutcomes: [],
  entryConditions: [],
  exitConditions: [],
  blockingRequirementKeys: [],
  autoAdvance: false,
  onReject: 'TERMINATE' as const,
});

const blueprint: InstantiatedWorkflowBlueprint = {
  blueprintKey: 'partner-onboarding',
  version: 2,
  scope: 'TENANT',
  workTypeKey: 'partner-onboarding',
  stages: [stage('qualification', 0), stage('review', 1)],
};
const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version, scope: blueprint.scope },
  state: 'RUNNING',
  currentStageKey: 'qualification',
  revision: 3,
  createdAt: '2026-08-25T07:00:00.000Z',
  startedAt: '2026-08-25T07:00:01.000Z',
  updatedAt: '2026-08-25T07:10:00.000Z',
};
const intent = {
  instanceId: instance.instanceId,
  expectedRevision: 3,
  fromStageKey: 'qualification',
  toStageKey: 'review',
  requestedBySubjectId: 'subject-1',
  requestedAt: '2026-08-25T07:11:00.000Z',
};

class MemoryRepository implements WorkflowInstanceRepository {
  current: WorkflowInstance | null = instance;
  commits: WorkflowInstanceCommit[] = [];
  commitResult: WorkflowInstanceCommitResult | null = null;

  async create(value: WorkflowInstance): Promise<WorkflowInstance> {
    this.current = value;
    return value;
  }

  async findById(): Promise<WorkflowInstance | null> {
    return this.current;
  }

  async commitTransition(commit: WorkflowInstanceCommit): Promise<WorkflowInstanceCommitResult> {
    this.commits.push(commit);
    if (this.commitResult !== null) return this.commitResult;
    this.current = commit.instance;
    return { committed: true, instance: commit.instance };
  }
}

test('blocked gate returns without persistence mutation', async () => {
  const repository = new MemoryRepository();
  const gates: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'REQUIREMENT', code: 'REQUIREMENT_PENDING' }],
      });
    },
  };

  const result = await new RepositoryWorkflowTransitionService({ instances: repository, gates }).execute({
    tenantId: instance.tenantId,
    blueprint,
    intent,
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(repository.commits.length, 0);
});

test('allowed transition calculates revision and commits atomically through repository', async () => {
  const repository = new MemoryRepository();
  const gates: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      return allowedWorkflowGateDecision(['route:next-stage']);
    },
  };

  const result = await new RepositoryWorkflowTransitionService({ instances: repository, gates }).execute({
    tenantId: instance.tenantId,
    blueprint,
    intent,
  });

  assert.equal(result.status, 'COMMITTED');
  if (result.status !== 'COMMITTED') return;
  assert.equal(result.instance.currentStageKey, 'review');
  assert.equal(result.instance.revision, 4);
  assert.equal(result.transition.revision, 4);
  assert.equal(repository.commits.length, 1);
  assert.equal(repository.commits[0]?.expectedRevision, 3);
});

test('stale request returns revision conflict before gate evaluation', async () => {
  const repository = new MemoryRepository();
  let gateCalls = 0;
  const gates: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      gateCalls += 1;
      return allowedWorkflowGateDecision();
    },
  };

  const result = await new RepositoryWorkflowTransitionService({ instances: repository, gates }).execute({
    tenantId: instance.tenantId,
    blueprint,
    intent: { ...intent, expectedRevision: 2 },
  });

  assert.deepEqual(result, { status: 'REVISION_CONFLICT' });
  assert.equal(gateCalls, 0);
});

test('repository race after gate is surfaced as revision conflict', async () => {
  const repository = new MemoryRepository();
  repository.commitResult = { committed: false, reason: 'REVISION_CONFLICT' };
  const gates: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      return allowedWorkflowGateDecision();
    },
  };

  const result = await new RepositoryWorkflowTransitionService({ instances: repository, gates }).execute({
    tenantId: instance.tenantId,
    blueprint,
    intent,
  });

  assert.deepEqual(result, { status: 'REVISION_CONFLICT' });
});

test('missing target stage is invalid and does not call gate', async () => {
  const repository = new MemoryRepository();
  let gateCalls = 0;
  const gates: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      gateCalls += 1;
      return allowedWorkflowGateDecision();
    },
  };

  const result = await new RepositoryWorkflowTransitionService({ instances: repository, gates }).execute({
    tenantId: instance.tenantId,
    blueprint,
    intent: { ...intent, toStageKey: 'missing' },
  });

  assert.deepEqual(result, { status: 'INVALID', code: 'WORKFLOW_TARGET_STAGE_NOT_FOUND' });
  assert.equal(gateCalls, 0);
});
