import type {
  AgentMission,
  AgentTask,
  ChiefOfStaffPersistencePort,
} from './chief-of-staff-types.ts';
import { GovernedTaskExecutor, type GovernedTaskExecutorOptions } from './governed-task-executor.ts';

export type MissionEventEmitter = (event: string, data: Record<string, unknown>) => void;

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

    await this.runExecutionLoop(persistence, createdTasks, emit);

    return mission;
  }

  private async runExecutionLoop(
    persistence: ChiefOfStaffPersistencePort,
    tasksList: AgentTask[],
    emit: MissionEventEmitter,
  ): Promise<void> {
    const completed = new Set<string>();
    const remaining = [...tasksList];

    while (remaining.length > 0) {
      const ready = remaining.filter((t) =>
        t.dependsOn.every((depId: string) => completed.has(depId)),
      );

      if (ready.length === 0) {
        emit('mission:error', { error: 'Circular task dependencies detected' });
        break;
      }

      for (const task of ready) {
        if (task.requiresApproval) {
          await persistence.createApprovalRequest({
            missionId: task.missionId,
            taskId: task.taskId,
            tenantId: task.tenantId,
            title: task.title,
            description: task.description,
            stagedChanges: task.actionPayload,
          });

          emit('task:needs_approval', {
            missionId: task.missionId,
            taskId: task.taskId,
            title: task.title,
          });
          completed.add(task.taskId);
          remaining.splice(remaining.indexOf(task), 1);
          continue;
        }

        emit('task:start', { missionId: task.missionId, taskId: task.taskId, title: task.title });
        const result = await this.executor.executeTask(task, task.assignedAgentId, emit);

        if (result.success) {
          emit('task:completed', { missionId: task.missionId, taskId: task.taskId, output: result.output });
          completed.add(task.taskId);
        } else {
          emit('task:failed', { missionId: task.missionId, taskId: task.taskId, error: result.error });
        }
        remaining.splice(remaining.indexOf(task), 1);
      }
    }
  }
}
