import type { ContentPublishingPolicy } from '@expadio/entity';

export interface AgentMission {
  readonly missionId: string;
  readonly tenantId: string;
  readonly userSubjectId: string;
  readonly intent: string;
  readonly status: 'PLANNING' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
  readonly summary: Record<string, unknown>;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

export interface AgentTask {
  readonly taskId: string;
  readonly missionId: string;
  readonly tenantId: string;
  readonly assignedAgentId: string;
  readonly title: string;
  readonly description: string;
  readonly actionPayload: Record<string, unknown>;
  readonly dependsOn: readonly string[];
  readonly requiresApproval: boolean;
  readonly status: 'QUEUED' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
  readonly outputArtifact: Record<string, unknown> | null;
  readonly error: string | null;
  readonly startedAt: Date | string | null;
  readonly completedAt: Date | string | null;
  readonly createdAt: Date | string;
}

export interface AgentApprovalRequest {
  readonly approvalId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly description: string;
  readonly stagedChanges: Record<string, unknown>;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly proposerSubjectId: string;
  readonly approverSubjectId: string | null;
  /** Set when this approval was staged via routeApprovalTarget() rather than
   * the task-level requiresApproval gate -- see committee-approval-staging.ts.
   * Null for approvals staged the older way (no node-based routing applied). */
  readonly targetApproverNodeId: string | null;
  readonly policyApplied: ContentPublishingPolicy | null;
  readonly telegramMessageId: number | null;
  readonly createdAt: Date | string;
  readonly resolvedAt: Date | string | null;
}

export interface ChiefOfStaffPersistencePort {
  createMission(input: {
    readonly tenantId: string;
    readonly userSubjectId: string;
    readonly intent: string;
  }): Promise<AgentMission>;

  isAgentActive(tenantId: string, agentId: string): Promise<boolean>;

  updateMissionStatus(
    missionId: string,
    tenantId: string,
    status: AgentMission['status'],
  ): Promise<void>;

  createTask(input: {
    readonly missionId: string;
    readonly tenantId: string;
    readonly assignedAgentId: string;
    readonly title: string;
    readonly description?: string;
    readonly actionPayload?: Record<string, unknown>;
    readonly dependsOn?: readonly string[];
    readonly requiresApproval?: boolean;
  }): Promise<AgentTask>;

  updateTaskStatus(
    taskId: string,
    tenantId: string,
    status: AgentTask['status'],
    outputArtifact?: Record<string, unknown> | null,
    error?: string | null,
  ): Promise<void>;

  createApprovalRequest(input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly title: string;
    readonly description?: string;
    readonly stagedChanges?: Record<string, unknown>;
    readonly proposerSubjectId: string;
  }): Promise<AgentApprovalRequest>;

  listMissionTasks(missionId: string, tenantId: string): Promise<readonly AgentTask[]>;

  getApprovalRequest(
    approvalId: string,
    tenantId: string,
  ): Promise<AgentApprovalRequest | null>;

  resolveApproval(input: {
    readonly approvalId: string;
    readonly missionId: string;
    readonly tenantId: string;
    readonly approved: boolean;
    readonly approverSubjectId: string;
    readonly reason?: string;
  }): Promise<AgentTask | null>;
}
