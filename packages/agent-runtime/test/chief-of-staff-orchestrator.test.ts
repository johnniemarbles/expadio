import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChiefOfStaffOrchestrator,
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
        telegramMessageId: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
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
  assert.ok(emitted.includes('task:queued'));
  assert.ok(emitted.includes('task:start'));
  assert.ok(emitted.includes('task:completed'));
});
