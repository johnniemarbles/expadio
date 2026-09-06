import type {
  AgentMission,
  AgentTask,
  ChiefOfStaffPersistencePort,
} from './chief-of-staff-types.ts';
import { GovernedTaskExecutor, type GovernedTaskExecutorOptions } from './governed-task-executor.ts';

export type MissionEventEmitter = (event: string, data: Record<string, unknown>) => void;

export type ChiefOfStaffApprovalErrorCode =
  | 'AGENT_SELF_APPROVAL_DENIED';

export class ChiefOfStaffApprovalError extends Error {
  readonly code: ChiefOfStaffApprovalErrorCode;

  constructor(code: ChiefOfStaffApprovalErrorCode, message: string) {
    super(message);
    this.name = 'ChiefOfStaffApprovalError';
    this.code = code;
  }
}

export interface ChiefOfStaffOrchestratorOptions {
  readonly executorOptions: GovernedTaskExecutorOptions;
}

export interface TaskPlanInput {
  readonly assignedAgentId: string;
  readonly title: string;
  readonly description?: string;
  readonly actionPayload?: Record<string, unknown>;
  readonly dependsOn?: readonly string[];
  readonly requiresApproval?: boolean;
}

export class ChiefOfStaffOrchestrator {
  private readonly executor: GovernedTaskExecutor;

  constructor(options: ChiefOfStaffOrchestratorOptions) {
    this.executor = new GovernedTaskExecutor(options.executorOptions);
  }

  async processExecutiveIntent(
    persistence: ChiefOfStaffPersistencePort,
    input: {
      readonly tenantId: string;
      readonly userSubjectId: string;
      readonly intent: string;
      readonly taskPlans?: readonly TaskPlanInput[];
    },
    emit: MissionEventEmitter,
  ): Promise<AgentMission> {
    const mission = await persistence.createMission({
      tenantId: input.tenantId,
      userSubjectId: input.userSubjectId,
      intent: input.intent,
    });

    emit('mission:created', { missionId: mission.missionId, intent: mission.intent });

    const plans: readonly TaskPlanInput[] = input.taskPlans ?? [
      {
        assignedAgentId: 'ops-admin-1',
        title: input.intent,
        description: `Executive command execution: ${input.intent}`,
        actionPayload: { role: 'OPS_ADMIN', context: input.intent },
        requiresApproval: false,
      },
    ];

    const createdTasks: AgentTask[] = [];
    for (const plan of plans) {
      if (!(await persistence.isAgentActive(input.tenantId, plan.assignedAgentId))) {
        throw new Error(`Agent ${plan.assignedAgentId} is not bound or active for this tenant.`);
      }

      const task = await persistence.createTask({
        missionId: mission.missionId,
        tenantId: input.tenantId,
        assignedAgentId: plan.assignedAgentId,
        title: plan.title,
        ...(plan.description !== undefined ? { description: plan.description } : {}),
        ...(plan.actionPayload !== undefined ? { actionPayload: plan.actionPayload } : {}),
        ...(plan.dependsOn !== undefined ? { dependsOn: plan.dependsOn } : {}),
        ...(plan.requiresApproval !== undefined ? { requiresApproval: plan.requiresApproval } : {}),
      });
      createdTasks.push(task);
      emit('task:queued', { missionId: mission.missionId, taskId: task.taskId, title: task.title });
    }

    await persistence.updateMissionStatus(mission.missionId, input.tenantId, 'IN_PROGRESS');
    emit('mission:in_progress', { missionId: mission.missionId });

    const finalStatus = await this.runExecutionLoop(
      persistence,
      createdTasks,
      input.tenantId,
      input.userSubjectId,
      emit,
    );
    await persistence.updateMissionStatus(mission.missionId, input.tenantId, finalStatus);
    emit('mission:done', { missionId: mission.missionId, status: finalStatus });

    return mission;
  }

  async resolveApproval(
    persistence: ChiefOfStaffPersistencePort,
    input: {
      readonly approvalId: string;
      readonly missionId: string;
      readonly tenantId: string;
      readonly approved: boolean;
      readonly approverSubjectId: string;
      readonly reason?: string;
    },
    emit: MissionEventEmitter,
  ): Promise<'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | null> {
    const pending = await persistence.getApprovalRequest(input.approvalId, input.tenantId);
    if (!pending) return null;

    if (pending.proposerSubjectId === input.approverSubjectId) {
      emit('approval:denied', {
        approvalId: input.approvalId,
        missionId: input.missionId,
        reason: 'AGENT_SELF_APPROVAL_DENIED',
      });
      throw new ChiefOfStaffApprovalError(
        'AGENT_SELF_APPROVAL_DENIED',
        'The subject who initiated this proposal cannot approve or reject it.',
      );
    }

    const task = await persistence.resolveApproval(input);
    if (!task) return null;

    if (!input.approved) {
      await persistence.updateMissionStatus(input.missionId, input.tenantId, 'FAILED');
      emit('mission:done', { missionId: input.missionId, status: 'FAILED' });
      return 'FAILED';
    }

    await persistence.updateMissionStatus(input.missionId, input.tenantId, 'IN_PROGRESS');
    const tasks = await persistence.listMissionTasks(input.missionId, input.tenantId);
    const status = await this.runExecutionLoop(
      persistence,
      tasks,
      input.tenantId,
      pending.proposerSubjectId,
      emit,
      new Set([task.taskId]),
    );
    await persistence.updateMissionStatus(input.missionId, input.tenantId, status);
    emit('mission:done', { missionId: input.missionId, status });
    return status;
  }

  private async runExecutionLoop(
    persistence: ChiefOfStaffPersistencePort,
    tasksList: readonly AgentTask[],
    tenantId: string,
    proposerSubjectId: string,
    emit: MissionEventEmitter,
    approvedTaskIds: ReadonlySet<string> = new Set(),
  ): Promise<'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL'> {
    const completed = new Set(tasksList.filter((task) => task.status === 'COMPLETED').map((task) => task.taskId));
    const remaining = tasksList.filter((task) => task.status === 'QUEUED');
    let anyFailed = false;
    let awaitingApproval = false;

    while (remaining.length > 0) {
      const ready = remaining.filter((t) =>
        t.dependsOn.every((depId: string) => completed.has(depId)),
      );

      if (ready.length === 0) {
        if (awaitingApproval) break;
        emit('mission:error', { error: 'Blocked or circular task dependencies detected' });
        anyFailed = true;
        break;
      }

      for (const task of ready) {
        if (task.requiresApproval && !approvedTaskIds.has(task.taskId)) {
          await persistence.createApprovalRequest({
            missionId: task.missionId,
            taskId: task.taskId,
            tenantId: task.tenantId,
            title: task.title,
            description: task.description,
            stagedChanges: task.actionPayload,
            proposerSubjectId,
          });
          await persistence.updateTaskStatus(task.taskId, tenantId, 'AWAITING_APPROVAL');

          emit('task:needs_approval', {
            missionId: task.missionId,
            taskId: task.taskId,
            title: task.title,
          });
          awaitingApproval = true;
          remaining.splice(remaining.indexOf(task), 1);
          continue;
        }

        emit('task:start', { missionId: task.missionId, taskId: task.taskId, title: task.title });
        await persistence.updateTaskStatus(task.taskId, tenantId, 'RUNNING');

        const result = await this.executor.executeTask(task, task.assignedAgentId, emit);

        if (result.success) {
          await persistence.updateTaskStatus(task.taskId, tenantId, 'COMPLETED', result.output);
          emit('task:completed', { missionId: task.missionId, taskId: task.taskId, output: result.output });
          completed.add(task.taskId);
        } else {
          await persistence.updateTaskStatus(task.taskId, tenantId, 'FAILED', null, result.error ?? null);
          emit('task:failed', { missionId: task.missionId, taskId: task.taskId, error: result.error });
          anyFailed = true;
        }
        remaining.splice(remaining.indexOf(task), 1);
      }
    }

    if (anyFailed) return 'FAILED';
    if (awaitingApproval) return 'AWAITING_APPROVAL';
    return 'COMPLETED';
  }
}
