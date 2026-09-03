import { randomUUID } from 'node:crypto';
import type { AgentMission, AgentTask, AgentApprovalRequest, ChiefOfStaffPersistencePort } from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';

export type { AgentMission, AgentTask, AgentApprovalRequest, ChiefOfStaffPersistencePort };

interface RawMissionRow {
  readonly mission_id: string;
  readonly tenant_id: string;
  readonly user_subject_id: string;
  readonly intent: string;
  readonly status: 'PLANNING' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
  readonly summary: Record<string, unknown> | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface RawTaskRow {
  readonly task_id: string;
  readonly mission_id: string;
  readonly tenant_id: string;
  readonly assigned_agent_id: string;
  readonly title: string;
  readonly description: string;
  readonly action_payload: Record<string, unknown> | null;
  readonly depends_on: readonly string[] | null;
  readonly requires_approval: boolean;
  readonly status: 'QUEUED' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
  readonly output_artifact: Record<string, unknown> | null;
  readonly error: string | null;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly created_at: Date | string;
}

interface RawApprovalRow {
  readonly approval_id: string;
  readonly mission_id: string;
  readonly task_id: string;
  readonly tenant_id: string;
  readonly title: string;
  readonly description: string;
  readonly staged_changes: Record<string, unknown> | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly telegram_message_id: string | number | null;
  readonly created_at: Date | string;
  readonly resolved_at: Date | string | null;
}

export class PostgresChiefOfStaffRepository implements ChiefOfStaffPersistencePort {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async createMission(input: {
    readonly tenantId: string;
    readonly userSubjectId: string;
    readonly intent: string;
  }): Promise<AgentMission> {
    return createAgentMission(this.#client, input);
  }

  async createTask(input: {
    readonly missionId: string;
    readonly tenantId: string;
    readonly assignedAgentId: string;
    readonly title: string;
    readonly description?: string;
    readonly actionPayload?: Record<string, unknown>;
    readonly dependsOn?: readonly string[];
    readonly requiresApproval?: boolean;
  }): Promise<AgentTask> {
    return createAgentTask(this.#client, input);
  }

  async createApprovalRequest(input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly title: string;
    readonly description?: string;
    readonly stagedChanges?: Record<string, unknown>;
  }): Promise<AgentApprovalRequest> {
    return createAgentApprovalRequest(this.#client, input);
  }
}

export async function createAgentMission(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly userSubjectId: string;
    readonly intent: string;
  },
): Promise<AgentMission> {
  const missionId = randomUUID();
  const query = `
    INSERT INTO platform.agent_missions (
      mission_id, tenant_id, user_subject_id, intent, status
    ) VALUES ($1, $2, $3, $4, 'PLANNING')
    RETURNING mission_id, tenant_id, user_subject_id, intent, status, summary, created_at, updated_at;
  `;
  const result = await client.query<RawMissionRow>(query, [
    missionId,
    input.tenantId,
    input.userSubjectId,
    input.intent,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('AGENT_MISSION_CREATION_FAILED');
  return {
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    userSubjectId: row.user_subject_id,
    intent: row.intent,
    status: row.status,
    summary: row.summary ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createAgentTask(
  client: PostgresClient,
  input: {
    readonly missionId: string;
    readonly tenantId: string;
    readonly assignedAgentId: string;
    readonly title: string;
    readonly description?: string;
    readonly actionPayload?: Record<string, unknown>;
    readonly dependsOn?: readonly string[];
    readonly requiresApproval?: boolean;
  },
): Promise<AgentTask> {
  const taskId = randomUUID();
  const query = `
    INSERT INTO platform.agent_tasks (
      task_id, mission_id, tenant_id, assigned_agent_id, title, description, action_payload, depends_on, requires_approval, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'QUEUED')
    RETURNING task_id, mission_id, tenant_id, assigned_agent_id, title, description, action_payload, depends_on, requires_approval, status, output_artifact, error, started_at, completed_at, created_at;
  `;
  const result = await client.query<RawTaskRow>(query, [
    taskId,
    input.missionId,
    input.tenantId,
    input.assignedAgentId,
    input.title,
    input.description ?? '',
    JSON.stringify(input.actionPayload ?? {}),
    JSON.stringify(input.dependsOn ?? []),
    input.requiresApproval ?? false,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('AGENT_TASK_CREATION_FAILED');
  return {
    taskId: row.task_id,
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    assignedAgentId: row.assigned_agent_id,
    title: row.title,
    description: row.description,
    actionPayload: row.action_payload ?? {},
    dependsOn: row.depends_on ?? [],
    requiresApproval: row.requires_approval,
    status: row.status,
    outputArtifact: row.output_artifact ?? null,
    error: row.error ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export async function createAgentApprovalRequest(
  client: PostgresClient,
  input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly title: string;
    readonly description?: string;
    readonly stagedChanges?: Record<string, unknown>;
  },
): Promise<AgentApprovalRequest> {
  const approvalId = randomUUID();
  const query = `
    INSERT INTO platform.agent_approval_requests (
      approval_id, mission_id, task_id, tenant_id, title, description, staged_changes, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
    RETURNING approval_id, mission_id, task_id, tenant_id, title, description, staged_changes, status, telegram_message_id, created_at, resolved_at;
  `;
  const result = await client.query<RawApprovalRow>(query, [
    approvalId,
    input.missionId,
    input.taskId,
    input.tenantId,
    input.title,
    input.description ?? '',
    JSON.stringify(input.stagedChanges ?? {}),
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('AGENT_APPROVAL_CREATION_FAILED');
  return {
    approvalId: row.approval_id,
    missionId: row.mission_id,
    taskId: row.task_id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    stagedChanges: row.staged_changes ?? {},
    status: row.status,
    telegramMessageId: row.telegram_message_id ? Number(row.telegram_message_id) : null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}
