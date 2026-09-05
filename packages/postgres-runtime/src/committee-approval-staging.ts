import { routeApprovalTarget, type ApprovalRoutingClosure, type ApprovalRoutingResult, type GovernancePolicyRepository } from '@expadio/entity';
import type { PostgresClient } from './index.ts';
import { getAgentTenantMemory } from './agent-tenant-memory.ts';
import { PostgresGovernancePolicyRepository } from './entity-governance.ts';
import { PostgresClosureRepository } from './closure.ts';
import { createAgentApprovalRequest } from './chief-of-staff.ts';

export class CommitteeApprovalStagingError extends Error {
  readonly code:
    | 'COMMITTEE_TASK_NOT_FOUND'
    | 'COMMITTEE_TASK_NOT_COMPLETED'
    | 'COMMITTEE_OUTPUT_REFERENCE_INVALID'
    | 'COMMITTEE_OUTPUT_NOT_FOUND'
    | 'COMMITTEE_INITIATING_NODE_UNRESOLVED';

  constructor(
    code:
      | 'COMMITTEE_TASK_NOT_FOUND'
      | 'COMMITTEE_TASK_NOT_COMPLETED'
      | 'COMMITTEE_OUTPUT_REFERENCE_INVALID'
      | 'COMMITTEE_OUTPUT_NOT_FOUND'
      | 'COMMITTEE_INITIATING_NODE_UNRESOLVED',
    message: string,
  ) {
    super(message);
    this.name = 'CommitteeApprovalStagingError';
    this.code = code;
  }
}

const MEMORY_REFERENCE_PATTERN = /^memory:\/\/(.+)$/u;

interface TaskRow {
  readonly mission_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly output_artifact: { readonly observation?: { readonly outputReference?: string } } | null;
}

export interface StageCommitteeOutputForApprovalResult {
  readonly approvalId: string;
  readonly targetApproverNodeId: string;
  readonly policyApplied: ApprovalRoutingResult['policyApplied'];
}

/**
 * The connecting piece between a completed committee tool (Phase 3/5/6 --
 * content.editorial.debate, revenue.lead.osint, revenue.outreach.draft_sequence,
 * voice.callback.prepare) and the Decision Fabric. Those tools are all
 * effect: 'OBSERVE', so they run and complete without ever creating an
 * approval request -- their output just sits in agent_tenant_memory. This
 * reads that output back out, resolves which entity node's governance
 * authority should see it (routeApprovalTarget(), Phase 4), and stages a
 * real platform.agent_approval_requests row with the actual drafted content
 * as stagedChanges -- not the task's input payload, which is what the
 * task-level requiresApproval gate stages today.
 *
 * The initiating entity node is resolved from the caller's IAM organization
 * via platform.entity_nodes.organization_id (migration 0127's existing
 * "what entity is this org?" link) rather than adding a node_id column to
 * platform.agent_missions/agent_tasks -- those tables stay tenant-scoped
 * only, as documented when this was deferred in Phase 4.
 */
export async function stageCommitteeOutputForApproval(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly taskId: string;
    readonly organizationId: string;
    readonly proposerSubjectId: string;
  },
): Promise<StageCommitteeOutputForApprovalResult> {
  const taskResult = await client.query<TaskRow>(
    `SELECT mission_id, title, description, status, output_artifact
       FROM platform.agent_tasks
      WHERE task_id = $1 AND tenant_id = $2`,
    [input.taskId, input.tenantId],
  );
  const task = taskResult.rows[0];
  if (!task) {
    throw new CommitteeApprovalStagingError(
      'COMMITTEE_TASK_NOT_FOUND',
      `No task found for id "${input.taskId}".`,
    );
  }
  if (task.status !== 'COMPLETED') {
    throw new CommitteeApprovalStagingError(
      'COMMITTEE_TASK_NOT_COMPLETED',
      `Task "${input.taskId}" is not COMPLETED (status: ${task.status}).`,
    );
  }

  const outputReference = task.output_artifact?.observation?.outputReference;
  if (typeof outputReference !== 'string') {
    throw new CommitteeApprovalStagingError(
      'COMMITTEE_OUTPUT_REFERENCE_INVALID',
      `Task "${input.taskId}" has no output reference to stage.`,
    );
  }
  const match = MEMORY_REFERENCE_PATTERN.exec(outputReference);
  if (!match) {
    throw new CommitteeApprovalStagingError(
      'COMMITTEE_OUTPUT_REFERENCE_INVALID',
      `Unsupported output reference "${outputReference}" -- only memory:// references can be staged.`,
    );
  }
  const memoryKey = match[1] as string;
  const record = await getAgentTenantMemory(client, input.tenantId, memoryKey);
  if (!record) {
    throw new CommitteeApprovalStagingError(
      'COMMITTEE_OUTPUT_NOT_FOUND',
      `No artifact found at "${outputReference}".`,
    );
  }

  const nodeResult = await client.query<{ node_id: string }>(
    `SELECT node_id FROM platform.entity_nodes
      WHERE tenant_id = $1 AND organization_id = $2 AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.organizationId],
  );
  const nodeId = nodeResult.rows[0]?.node_id;
  if (!nodeId) {
    throw new CommitteeApprovalStagingError(
      'COMMITTEE_INITIATING_NODE_UNRESOLVED',
      `No active entity node is linked to organization "${input.organizationId}".`,
    );
  }

  const policyRepo: GovernancePolicyRepository = new PostgresGovernancePolicyRepository(client);
  const closureRepo: ApprovalRoutingClosure = new PostgresClosureRepository(client);
  const routing = await routeApprovalTarget(policyRepo, closureRepo, { nodeId, tenantId: input.tenantId });

  const approval = await createAgentApprovalRequest(client, {
    missionId: task.mission_id,
    taskId: input.taskId,
    tenantId: input.tenantId,
    title: task.title,
    description: task.description,
    stagedChanges: record.memoryValue as Record<string, unknown>,
    proposerSubjectId: input.proposerSubjectId,
    targetApproverNodeId: routing.targetApproverNodeId,
    policyApplied: routing.policyApplied,
  });

  return {
    approvalId: approval.approvalId,
    targetApproverNodeId: routing.targetApproverNodeId,
    policyApplied: routing.policyApplied,
  };
}
