import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChiefOfStaffOrchestrator,
  ChiefOfStaffApprovalError,
  type AgentToolAuthorizationPort,
  type ChiefOfStaffPersistencePort,
  type AgentMission,
  type AgentTask,
  type AgentApprovalRequest,
} from '../src/index.ts';

test('ChiefOfStaffOrchestrator processes executive intent and emits events', async () => {
  const authorizationPort: AgentToolAuthorizationPort = {
    async authorize() {
      return { decisionId: 'dec-1', allowed: true, reasonKey: 'GRANTED' };
    },
  };

  const orchestrator = new ChiefOfStaffOrchestrator({
    executorOptions: { authorizationPort },
  });

  const missionStatusLog: string[] = [];
  const taskStatusLog: string[] = [];

  const mockPersistence: ChiefOfStaffPersistencePort = {
    async createMission(input): Promise<AgentMission> {
      return {
        missionId: 'mission-1',
        tenantId: input.tenantId,
        userSubjectId: input.userSubjectId,
        intent: input.intent,
        status: 'PLANNING',
        summary: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async updateMissionStatus(_missionId, _tenantId, status): Promise<void> {
      missionStatusLog.push(status);
    },
    async createTask(input): Promise<AgentTask> {
      return {
        taskId: 'task-1',
        missionId: input.missionId,
        tenantId: input.tenantId,
        assignedAgentId: input.assignedAgentId,
        title: input.title,
        description: input.description ?? '',
        actionPayload: input.actionPayload ?? {},
        dependsOn: input.dependsOn ?? [],
        requiresApproval: input.requiresApproval ?? false,
        status: 'QUEUED',
        outputArtifact: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      };
    },
    async updateTaskStatus(_taskId, _tenantId, status): Promise<void> {
      taskStatusLog.push(status);
    },
    async createApprovalRequest(input): Promise<AgentApprovalRequest> {
      return {
        approvalId: 'appr-1',
        missionId: input.missionId,
        taskId: input.taskId,
        tenantId: input.tenantId,
        title: input.title,
        description: input.description ?? '',
        stagedChanges: input.stagedChanges ?? {},
        status: 'PENDING',
        proposerSubjectId: input.proposerSubjectId,
        approverSubjectId: null,
        telegramMessageId: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
    },
    async listMissionTasks(): Promise<readonly AgentTask[]> {
      return [];
    },
    async getApprovalRequest(): Promise<AgentApprovalRequest | null> {
      return null;
    },
    async resolveApproval(): Promise<AgentTask | null> {
      return null;
    },
  };

  const emitted: string[] = [];
  const mission = await orchestrator.processExecutiveIntent(
    mockPersistence,
    {
      tenantId: '00000000-0000-0000-0000-000000000001',
      userSubjectId: 'sub-1',
      intent: 'Analyze system security posture',
    },
    (event) => emitted.push(event),
  );

  assert.equal(mission.missionId, 'mission-1');
  assert.ok(emitted.includes('mission:created'));
  assert.ok(emitted.includes('mission:in_progress'));
  assert.ok(emitted.includes('mission:done'));
  assert.ok(emitted.includes('task:queued'));
  assert.ok(emitted.includes('task:start'));
  assert.ok(emitted.includes('task:completed'));

  assert.deepEqual(missionStatusLog, ['IN_PROGRESS', 'COMPLETED']);
  assert.ok(taskStatusLog.includes('RUNNING'));
  assert.ok(taskStatusLog.includes('COMPLETED'));
});

test('ChiefOfStaffOrchestrator leaves a mission awaiting approval and resumes the approved task', async () => {
  const authorizationPort: AgentToolAuthorizationPort = {
    async authorize() { return { decisionId: 'dec-1', allowed: true, reasonKey: 'GRANTED' }; },
  };
  const orchestrator = new ChiefOfStaffOrchestrator({ executorOptions: { authorizationPort } });
  const statuses: string[] = [];
  const task: AgentTask = {
    taskId: 'task-approval', missionId: 'mission-approval', tenantId: 'tenant-1', assignedAgentId: 'agent-1',
    title: 'Review draft', description: '', actionPayload: {}, dependsOn: [], requiresApproval: true,
    status: 'QUEUED', outputArtifact: null, error: null, startedAt: null, completedAt: null, createdAt: new Date().toISOString(),
  };
  const approvalRecord: AgentApprovalRequest = {
    approvalId: 'approval-1', missionId: 'mission-approval', taskId: 'task-approval', tenantId: 'tenant-1',
    title: 'Review draft', description: '', stagedChanges: {}, status: 'PENDING',
    proposerSubjectId: 'sub-1', approverSubjectId: null, telegramMessageId: null, createdAt: '', resolvedAt: null,
  };
  const persistence: ChiefOfStaffPersistencePort = {
    async createMission(input) { return { missionId: 'mission-approval', tenantId: input.tenantId, userSubjectId: input.userSubjectId, intent: input.intent, status: 'PLANNING', summary: {}, createdAt: '', updatedAt: '' }; },
    async updateMissionStatus(_missionId, _tenantId, status) { statuses.push(status); },
    async createTask() { return task; },
    async updateTaskStatus() {},
    async createApprovalRequest(input) { return { ...approvalRecord, missionId: input.missionId, taskId: input.taskId, tenantId: input.tenantId, title: input.title, proposerSubjectId: input.proposerSubjectId }; },
    async listMissionTasks() { return [{ ...task, status: 'QUEUED' as const }]; },
    async getApprovalRequest() { return approvalRecord; },
    async resolveApproval() { return { ...task, status: 'QUEUED' as const }; },
  };

  await orchestrator.processExecutiveIntent(persistence, { tenantId: 'tenant-1', userSubjectId: 'sub-1', intent: 'Review draft', taskPlans: [{ assignedAgentId: 'agent-1', title: 'Review draft', requiresApproval: true }] }, () => {});
  assert.deepEqual(statuses, ['IN_PROGRESS', 'AWAITING_APPROVAL']);

  const status = await orchestrator.resolveApproval(persistence, { approvalId: 'approval-1', missionId: 'mission-approval', tenantId: 'tenant-1', approved: true, approverSubjectId: 'sub-2' }, () => {});
  assert.equal(status, 'COMPLETED');
  assert.deepEqual(statuses, ['IN_PROGRESS', 'AWAITING_APPROVAL', 'IN_PROGRESS', 'COMPLETED']);
});

test('ChiefOfStaffOrchestrator denies self-approval of a proposal', async () => {
  const authorizationPort: AgentToolAuthorizationPort = {
    async authorize() { return { decisionId: 'dec-1', allowed: true, reasonKey: 'GRANTED' }; },
  };
  const orchestrator = new ChiefOfStaffOrchestrator({ executorOptions: { authorizationPort } });

  const approvalRecord: AgentApprovalRequest = {
    approvalId: 'approval-2', missionId: 'mission-2', taskId: 'task-2', tenantId: 'tenant-1',
    title: 'Publish campaign', description: '', stagedChanges: {}, status: 'PENDING',
    proposerSubjectId: 'sub-1', approverSubjectId: null, telegramMessageId: null, createdAt: '', resolvedAt: null,
  };

  let resolveApprovalCalled = false;
  const persistence: ChiefOfStaffPersistencePort = {
    async createMission() { throw new Error('not used'); },
    async updateMissionStatus() {},
    async createTask() { throw new Error('not used'); },
    async updateTaskStatus() {},
    async createApprovalRequest() { throw new Error('not used'); },
    async listMissionTasks() { return []; },
    async getApprovalRequest() { return approvalRecord; },
    async resolveApproval() {
      resolveApprovalCalled = true;
      throw new Error('should not be reached');
    },
  };

  await assert.rejects(
    () =>
      orchestrator.resolveApproval(
        persistence,
        {
          approvalId: 'approval-2',
          missionId: 'mission-2',
          tenantId: 'tenant-1',
          approved: true,
          approverSubjectId: 'sub-1', // same as proposerSubjectId
        },
        () => {},
      ),
    (err: unknown) => err instanceof ChiefOfStaffApprovalError && err.code === 'AGENT_SELF_APPROVAL_DENIED',
  );
  assert.equal(resolveApprovalCalled, false);
});
