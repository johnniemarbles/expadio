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

  createApprovalRequest(input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly title: string;
    readonly description?: string;
    readonly stagedChanges?: Record<string, unknown>;
  }): Promise<AgentApprovalRequest>;
}
