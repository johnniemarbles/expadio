import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentApprovalError,
  authorizeApprovedAgentAction,
  type AgentActionProposal,
  type HumanApprovalDecision,
} from '../src/index.ts';

const proposal: AgentActionProposal = {
  proposalReference: 'proposal://account/7/update',
  tenantId: 'tenant-1',
  executionId: 'execution-1',
  proposerSubjectId: 'subject-agent-owner',
  agentId: 'agent-1',
  toolKey: 'account-update-proposal',
  action: 'account.update',
  targetResourceType: 'account',
  targetResourceId: 'account-7',
  payloadReference: 'payload://proposal/7',
  createdAt: '2026-08-25T18:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['evidence://agent/run/1'],
};

const approval: HumanApprovalDecision = {
  decisionId: 'approval-1',
  proposalReference: proposal.proposalReference,
  tenantId: proposal.tenantId,
  approverSubjectId: 'subject-reviewer',
  status: 'APPROVED',
  reason: 'Verified against the account source record.',
  decidedAt: '2026-08-25T18:05:00.000Z',
  evidenceRefs: ['evidence://review/1'],
};

test('turns an exact human approval into an execution authorization receipt', () => {
  const authorized = authorizeApprovedAgentAction(proposal, approval);

  assert.deepEqual(authorized, {
    tenantId: 'tenant-1',
    proposalReference: 'proposal://account/7/update',
    approvalDecisionId: 'approval-1',
    approverSubjectId: 'subject-reviewer',
    action: 'account.update',
    targetResourceType: 'account',
    targetResourceId: 'account-7',
    payloadReference: 'payload://proposal/7',
    correlationId: 'correlation-1',
    evidenceRefs: [
      'evidence://agent/run/1',
      'evidence://review/1',
    ],
  });
});

test('rejects approval from another tenant or for another proposal', () => {
  assert.throws(
    () =>
      authorizeApprovedAgentAction(proposal, {
        ...approval,
        tenantId: 'tenant-2',
      }),
    (error: unknown) =>
      error instanceof AgentApprovalError
      && error.code === 'AGENT_APPROVAL_IDENTITY_MISMATCH',
  );
});

test('blocks proposal authors from approving their own actions', () => {
  assert.throws(
    () =>
      authorizeApprovedAgentAction(proposal, {
        ...approval,
        approverSubjectId: proposal.proposerSubjectId,
      }),
    (error: unknown) =>
      error instanceof AgentApprovalError
      && error.code === 'AGENT_SELF_APPROVAL_DENIED',
  );
});

test('does not authorize rejected proposals', () => {
  assert.throws(
    () =>
      authorizeApprovedAgentAction(proposal, {
        ...approval,
        status: 'REJECTED',
        reason: 'The source record does not support the change.',
      }),
    (error: unknown) =>
      error instanceof AgentApprovalError
      && error.code === 'AGENT_PROPOSAL_REJECTED',
  );
});

test('requires approval evidence and a stable reason', () => {
  assert.throws(
    () =>
      authorizeApprovedAgentAction(proposal, {
        ...approval,
        reason: ' ',
        evidenceRefs: [],
      }),
    (error: unknown) =>
      error instanceof AgentApprovalError
      && error.code === 'AGENT_APPROVAL_INVALID',
  );
});
