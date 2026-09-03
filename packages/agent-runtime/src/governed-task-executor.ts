import { randomUUID } from 'node:crypto';
import type { AgentTask } from './chief-of-staff-types.ts';
import {
  AuthorizedAgentRuntime,
  type AgentToolAuthorizationPort,
  type AgentToolAdapter,
  type AgentToolIntent,
} from './index.ts';

export type TaskEventEmitter = (event: string, data: Record<string, unknown>) => void;

export interface GovernedTaskExecutorOptions {
  readonly authorizationPort: AgentToolAuthorizationPort;
  readonly registeredTools?: readonly AgentToolAdapter[];
}

export class GovernedTaskExecutor {
  private readonly maxIterations = 10;
  private readonly runtime: AuthorizedAgentRuntime;

  constructor(options: GovernedTaskExecutorOptions) {
    this.runtime = new AuthorizedAgentRuntime({
      authorization: options.authorizationPort,
      tools: options.registeredTools ?? [],
    });
  }

  async executeTask(
    task: AgentTask,
    agentRole: string,
    emit: TaskEventEmitter,
  ): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    emit('task:log', { taskId: task.taskId, message: `Starting task execution for role ${agentRole}` });

    const executionId = randomUUID();
    const correlationId = randomUUID();

    try {
      const actionPayload = task.actionPayload;
      const toolKey = typeof actionPayload.toolKey === 'string' ? actionPayload.toolKey : null;

      if (toolKey) {
        const intent: AgentToolIntent = {
          executionId,
          tenantId: task.tenantId,
          requesterSubjectId: 'cbos:chief-of-staff',
          agentId: task.assignedAgentId,
          toolKey,
          effect: (actionPayload.effect as 'OBSERVE' | 'PROPOSE') || 'OBSERVE',
          purpose: `Execute task: ${task.title}`,
          inputReference: `ref:task:${task.taskId}:input`,
          contextBundleReference: `ref:task:${task.taskId}:context`,
          idempotencyKey: `task:${task.taskId}:${Date.now()}`,
          requestedAt: new Date().toISOString(),
          correlationId,
          evidenceRefs: [`evidence:task:${task.taskId}`],
        };

        emit('task:tool_call', { taskId: task.taskId, toolKey, intent });
        const receipt = await this.runtime.invoke(intent);
        emit('task:tool_result', { taskId: task.taskId, toolKey, receipt });

        return {
          success: true,
          output: {
            receiptId: receipt.executionId,
            observation: receipt.observation,
            summary: `Task "${task.title}" completed via governed tool ${toolKey}`,
          },
        };
      }

      return {
        success: true,
        output: {
          summary: `Task "${task.title}" executed successfully`,
          details: task.actionPayload,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      emit('task:failed', { taskId: task.taskId, error: errorMessage });
      return {
        success: false,
        output: {},
        error: errorMessage,
      };
    }
  }
}
