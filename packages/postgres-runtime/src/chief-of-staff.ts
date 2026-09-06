import { randomUUID } from 'node:crypto';
import type { AgentMission, AgentTask, AgentApprovalRequest, ChiefOfStaffPersistencePort } from '@expadio/agent-runtime';
import type { ContentPublishingPolicy } from '@expadio/entity';
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
  readonly proposer_subject_id: string;
  readonly approver_subject_id: string | null;
  readonly target_approver_node_id: string | null;
  readonly policy_applied: ContentPublishingPolicy | null;
  readonly telegram_message_id: string | number | null;
  readonly created_at: Date | string;
  readonly resolved_at: Date | string | null;
}

const APPROVAL_COLUMNS = `approval_id, mission_id, task_id, tenant_id, title, description,
                staged_changes, status, proposer_subject_id, approver_subject_id,
                target_approver_node_id, policy_applied,
                telegram_message_id, created_at, resolved_at`;

function mapApproval(row: RawApprovalRow): AgentApprovalRequest {
  return {
    approvalId: row.approval_id,
    missionId: row.mission_id,
    taskId: row.task_id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    stagedChanges: row.staged_changes ?? {},
    status: row.status,
    targetApproverNodeId: row.target_approver_node_id,
    policyApplied: row.policy_applied,
    proposerSubjectId: row.proposer_subject_id,
    approverSubjectId: row.approver_subject_id,
    telegramMessageId: row.telegram_message_id ? Number(row.telegram_message_id) : null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
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

  async updateMissionStatus(
    missionId: string,
    tenantId: string,
    status: AgentMission['status'],
  ): Promise<void> {
    return updateAgentMissionStatus(this.#client, missionId, tenantId, status);
  }

  async updateTaskStatus(
    taskId: string,
    tenantId: string,
    status: AgentTask['status'],
    outputArtifact: Record<string, unknown> | null = null,
    error: string | null = null,
  ): Promise<void> {
    return updateAgentTaskStatus(this.#client, taskId, tenantId, status, outputArtifact, error);
  }

  async createApprovalRequest(input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly title: string;
    readonly description?: string;
    readonly stagedChanges?: Record<string, unknown>;
    readonly proposerSubjectId: string;
  }): Promise<AgentApprovalRequest> {
    return createAgentApprovalRequest(this.#client, input);
  }

  async listMissionTasks(missionId: string, tenantId: string): Promise<readonly AgentTask[]> {
    return listAgentMissionTasks(this.#client, missionId, tenantId);
  }

  async getApprovalRequest(
    approvalId: string,
    tenantId: string,
  ): Promise<AgentApprovalRequest | null> {
    return getAgentApprovalRequest(this.#client, approvalId, tenantId);
  }

  async resolveApproval(input: {
    readonly approvalId: string;
    readonly missionId: string;
    readonly tenantId: string;
    readonly approved: boolean;
    readonly approverSubjectId: string;
    readonly reason?: string;
  }): Promise<AgentTask | null> {
    return resolveAgentApproval(this.#client, input);
  }

  async isAgentActive(tenantId: string, agentSlug: string): Promise<boolean> {
    // Check if it's a platform capability
    const capRes = await this.#client.query(
      `SELECT 1 FROM platform.tenant_capability_bindings b
       JOIN platform.capabilities c ON b.capability_id = c.capability_id
       JOIN platform.capability_state s ON s.binding_id = b.binding_id
       WHERE b.tenant_id = $1 AND c.capability_key = $2 AND s.state = 'ACTIVE' LIMIT 1`,
      [tenantId, agentSlug]
    );
    if ((capRes.rowCount ?? 0) > 0) return true;

    // Otherwise, check if it's a persona agent and verify its tool grants
    const agentRes = await this.#client.query(
      `SELECT a.tools 
       FROM platform.tenant_agent_bindings b
       JOIN platform.agent_definitions a ON a.agent_id = b.agent_id
       WHERE b.tenant_id = $1 AND a.slug = $2 AND b.status = 'ACTIVE' LIMIT 1`,
      [tenantId, agentSlug]
    );
    if ((agentRes.rowCount ?? 0) === 0) return false;

    const tools = agentRes.rows[0].tools as string[];
    if (!tools || tools.length === 0) return true;

    const toolsRes = await this.#client.query(
      `SELECT tool_group FROM platform.tenant_tool_grants 
       WHERE tenant_id = $1 AND enabled = true AND tool_group = ANY($2::text[])`,
      [tenantId, tools]
    );

    if ((toolsRes.rowCount ?? 0) !== tools.length) return false;

    // Phase 4: Integrate Communications provider health as preflight check
    if (tools.includes('Comms')) {
      const commsRes = await this.#client.query(
        `SELECT 1 FROM platform.connectors
         WHERE (tenant_id IS NULL OR tenant_id = $1::uuid)
           AND enabled = true
           AND health = 'HEALTHY'
           AND provider_type IN ('email','sms','whatsapp','voice','push','rcs')
         LIMIT 1`,
        [tenantId]
      );
      if ((commsRes.rowCount ?? 0) === 0) return false;
    }

    return true;
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

export async function updateAgentMissionStatus(
  client: PostgresClient,
  missionId: string,
  tenantId: string,
  status: AgentMission['status'],
): Promise<void> {
  await client.query(
    `UPDATE platform.agent_missions
        SET status = $1, updated_at = now()
      WHERE mission_id = $2 AND tenant_id = $3`,
    [status, missionId, tenantId],
  );
}

export async function updateAgentTaskStatus(
  client: PostgresClient,
  taskId: string,
  tenantId: string,
  status: AgentTask['status'],
  outputArtifact: Record<string, unknown> | null = null,
  error: string | null = null,
): Promise<void> {
  const startedAt = status === 'RUNNING' ? 'now()' : null;
  const completedAt = status === 'COMPLETED' || status === 'FAILED' ? 'now()' : null;

  await client.query(
    `UPDATE platform.agent_tasks
        SET status = $1,
            output_artifact = COALESCE($2::jsonb, output_artifact),
            error = $3,
            started_at = CASE WHEN $4::boolean THEN now() ELSE started_at END,
            completed_at = CASE WHEN $5::boolean THEN now() ELSE completed_at END
      WHERE task_id = $6 AND tenant_id = $7`,
    [
      status,
      outputArtifact !== null ? JSON.stringify(outputArtifact) : null,
      error,
      startedAt !== null,
      completedAt !== null,
      taskId,
      tenantId,
    ],
  );
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
    readonly proposerSubjectId: string;
    /** Set only by callers that routed this approval via routeApprovalTarget()
     * (see committee-approval-staging.ts) -- the task-level requiresApproval
     * gate does not set these, since it has no entity node to route from. */
    readonly targetApproverNodeId?: string;
    readonly policyApplied?: ContentPublishingPolicy;
  },
): Promise<AgentApprovalRequest> {
  const approvalId = randomUUID();
  const query = `
    INSERT INTO platform.agent_approval_requests (
      approval_id, mission_id, task_id, tenant_id, title, description, staged_changes,
      status, proposer_subject_id, target_approver_node_id, policy_applied
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10)
    RETURNING ${APPROVAL_COLUMNS};
  `;
  const result = await client.query<RawApprovalRow>(query, [
    approvalId,
    input.missionId,
    input.taskId,
    input.tenantId,
    input.title,
    input.description ?? '',
    JSON.stringify(input.stagedChanges ?? {}),
    input.proposerSubjectId,
    input.targetApproverNodeId ?? null,
    input.policyApplied ?? null,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('AGENT_APPROVAL_CREATION_FAILED');
  return mapApproval(row);
}

export async function getAgentApprovalRequest(
  client: PostgresClient,
  approvalId: string,
  tenantId: string,
): Promise<AgentApprovalRequest | null> {
  const result = await client.query<RawApprovalRow>(
    `SELECT ${APPROVAL_COLUMNS}
       FROM platform.agent_approval_requests
      WHERE approval_id = $1 AND tenant_id = $2`,
    [approvalId, tenantId],
  );
  const row = result.rows[0];
  return row ? mapApproval(row) : null;
}

function mapTask(row: RawTaskRow): AgentTask {
  return {
    taskId: row.task_id, missionId: row.mission_id, tenantId: row.tenant_id,
    assignedAgentId: row.assigned_agent_id, title: row.title, description: row.description,
    actionPayload: row.action_payload ?? {}, dependsOn: row.depends_on ?? [],
    requiresApproval: row.requires_approval, status: row.status,
    outputArtifact: row.output_artifact ?? null, error: row.error ?? null,
    startedAt: row.started_at, completedAt: row.completed_at, createdAt: row.created_at,
  };
}

export async function listAgentMissionTasks(
  client: PostgresClient, missionId: string, tenantId: string,
): Promise<readonly AgentTask[]> {
  const result = await client.query<RawTaskRow>(
    `SELECT task_id, mission_id, tenant_id, assigned_agent_id, title, description,
            action_payload, depends_on, requires_approval, status, output_artifact,
            error, started_at, completed_at, created_at
       FROM platform.agent_tasks
      WHERE mission_id = $1 AND tenant_id = $2
      ORDER BY created_at ASC`,
    [missionId, tenantId],
  );
  return result.rows.map(mapTask);
}

export async function resolveAgentApproval(
  client: PostgresClient,
  input: {
    readonly approvalId: string;
    readonly missionId: string;
    readonly tenantId: string;
    readonly approved: boolean;
    readonly approverSubjectId: string;
    readonly reason?: string;
  },
): Promise<AgentTask | null> {
  const status = input.approved ? 'APPROVED' : 'REJECTED';
  const taskStatus = input.approved ? 'QUEUED' : 'FAILED';
  const result = await client.query<RawTaskRow>(
    `WITH approved_request AS (
       UPDATE platform.agent_approval_requests
          SET status = $1, approver_subject_id = $2, decision_reason = $3, resolved_at = now()
        WHERE approval_id = $4 AND mission_id = $5 AND tenant_id = $6
          AND status = 'PENDING' AND proposer_subject_id <> $2
      RETURNING task_id
     )
     UPDATE platform.agent_tasks AS task
        SET status = $7, error = $8
       FROM approved_request
      WHERE task.task_id = approved_request.task_id AND task.tenant_id = $6
      RETURNING task.task_id, task.mission_id, task.tenant_id, task.assigned_agent_id, task.title,
                task.description, task.action_payload, task.depends_on, task.requires_approval,
                task.status, task.output_artifact, task.error, task.started_at, task.completed_at, task.created_at`,
    [
      status,
      input.approverSubjectId,
      input.reason ?? null,
      input.approvalId,
      input.missionId,
      input.tenantId,
      taskStatus,
      input.approved ? null : 'Task rejected by human approval gate',
    ],
  );
  return result.rows[0] ? mapTask(result.rows[0]) : null;
}
