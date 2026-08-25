export interface AgentActionProposal {
  readonly proposalReference: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly proposerSubjectId: string;
  readonly agentId: string;
  readonly toolKey: string;
  readonly action: string;
  readonly targetResourceType: string;
  readonly targetResourceId: string;
  readonly payloadReference: string;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface HumanApprovalDecision {
  readonly decisionId: string;
  readonly proposalReference: string;
  readonly tenantId: string;
  readonly approverSubjectId: string;
  readonly status: 'APPROVED' | 'REJECTED';
  readonly reason: string;
  readonly decidedAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface ApprovedAgentAction {
  readonly tenantId: string;
  readonly proposalReference: string;
  readonly approvalDecisionId: string;
  readonly approverSubjectId: string;
  readonly action: string;
  readonly targetResourceType: string;
  readonly targetResourceId: string;
  readonly payloadReference: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export type AgentApprovalErrorCode =
  | 'AGENT_PROPOSAL_INVALID'
  | 'AGENT_APPROVAL_INVALID'
  | 'AGENT_APPROVAL_IDENTITY_MISMATCH'
  | 'AGENT_SELF_APPROVAL_DENIED'
  | 'AGENT_PROPOSAL_REJECTED';

export class AgentApprovalError extends Error {
  readonly code: AgentApprovalErrorCode;

  constructor(code: AgentApprovalErrorCode, message: string) {
    super(message);
    this.name = 'AgentApprovalError';
    this.code = code;
  }
}

export function authorizeApprovedAgentAction(
  proposal: AgentActionProposal,
  decision: HumanApprovalDecision,
): ApprovedAgentAction {
  validateProposal(proposal);
  validateDecision(decision);

  if (
    decision.tenantId !== proposal.tenantId
    || decision.proposalReference !== proposal.proposalReference
  ) {
    throw new AgentApprovalError(
      'AGENT_APPROVAL_IDENTITY_MISMATCH',
      'Approval must match the exact proposal and tenant.',
    );
  }
  if (decision.approverSubjectId === proposal.proposerSubjectId) {
    throw new AgentApprovalError(
      'AGENT_SELF_APPROVAL_DENIED',
      'The proposal author cannot approve their own agent action.',
    );
  }
  if (decision.status !== 'APPROVED') {
    throw new AgentApprovalError(
      'AGENT_PROPOSAL_REJECTED',
      'Rejected agent proposals cannot be authorized for execution.',
    );
  }

  return {
    tenantId: proposal.tenantId,
    proposalReference: proposal.proposalReference,
    approvalDecisionId: decision.decisionId,
    approverSubjectId: decision.approverSubjectId,
    action: proposal.action,
    targetResourceType: proposal.targetResourceType,
    targetResourceId: proposal.targetResourceId,
    payloadReference: proposal.payloadReference,
    correlationId: proposal.correlationId,
    evidenceRefs: [
      ...new Set([...proposal.evidenceRefs, ...decision.evidenceRefs]),
    ],
  };
}

function validateProposal(proposal: AgentActionProposal): void {
  if (
    !nonBlank(proposal.proposalReference)
    || !nonBlank(proposal.tenantId)
    || !nonBlank(proposal.executionId)
    || !nonBlank(proposal.proposerSubjectId)
    || !nonBlank(proposal.agentId)
    || !nonBlank(proposal.toolKey)
    || !nonBlank(proposal.action)
    || !nonBlank(proposal.targetResourceType)
    || !nonBlank(proposal.targetResourceId)
    || !nonBlank(proposal.payloadReference)
    || !validInstant(proposal.createdAt)
    || !nonBlank(proposal.correlationId)
    || !validEvidence(proposal.evidenceRefs)
  ) {
    throw new AgentApprovalError(
      'AGENT_PROPOSAL_INVALID',
      'Agent proposals require governed identity, target, payload, time, correlation, and evidence.',
    );
  }
}

function validateDecision(decision: HumanApprovalDecision): void {
  if (
    !nonBlank(decision.decisionId)
    || !nonBlank(decision.proposalReference)
    || !nonBlank(decision.tenantId)
    || !nonBlank(decision.approverSubjectId)
    || !nonBlank(decision.reason)
    || !validInstant(decision.decidedAt)
    || !validEvidence(decision.evidenceRefs)
  ) {
    throw new AgentApprovalError(
      'AGENT_APPROVAL_INVALID',
      'Human approval decisions require identity, reason, time, and evidence.',
    );
  }
}

function validEvidence(references: readonly string[]): boolean {
  return references.length > 0 && references.every(nonBlank);
}

function nonBlank(value: string): boolean {
  return value.trim() !== '';
}

function validInstant(value: string): boolean {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}
