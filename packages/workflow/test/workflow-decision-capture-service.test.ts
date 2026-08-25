import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthorityGatedWorkflowDecisionCaptureService,
  type WorkflowApprovalAuthorityProvider,
  type WorkflowDecisionCaptureInput,
  type WorkflowStageDecisionRepository,
} from '../src/index.ts';

const input: WorkflowDecisionCaptureInput = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  stageKey: 'decision',
  decisionId: 'decision-1',
  outcome: 'APPROVED',
  requestedBySubjectId: 'requester-1',
  approverSubjectId: 'approver-1',
  authorityRequirements: [{ dimensionKey: 'deal-value', requiredValue: 50000, unit: 'USD' }],
  decidedAt: '2026-08-25T09:00:00.000Z',
  code: 'APPROVED_BY_AUTHORITY',
  evidenceRefs: ['request:1'],
};

function decisions(onRecord?: (value: Parameters<WorkflowStageDecisionRepository['record']>[0]) => void): WorkflowStageDecisionRepository {
  return {
    async resolve() { return null; },
    async record(value) {
      onRecord?.(value);
      return {
        status: 'COMMITTED',
        decision: {
          stageKey: value.stageKey,
          status: 'RECORDED',
          decisionId: value.decisionId,
          outcome: value.outcome,
          decidedBySubjectId: value.decidedBySubjectId,
          decidedAt: value.decidedAt,
          code: value.code,
          evidenceRefs: [...value.evidenceRefs],
        },
      };
    },
  };
}

test('authority denial short-circuits immutable decision persistence', async () => {
  let recordCalls = 0;
  const authority: WorkflowApprovalAuthorityProvider = {
    async evaluate() {
      return {
        allowed: false,
        code: 'AUTHORITY_THRESHOLD_EXCEEDED',
        reason: 'Threshold exceeded.',
        evidenceRefs: ['authority:deny'],
      };
    },
  };
  const service = new AuthorityGatedWorkflowDecisionCaptureService(
    authority,
    decisions(() => { recordCalls += 1; }),
  );

  const result = await service.capture(input);
  assert.equal(result.status, 'AUTHORITY_DENIED');
  assert.equal(recordCalls, 0);
});

test('authorized capture persists approver identity plus authority and SoD evidence', async () => {
  const authority: WorkflowApprovalAuthorityProvider = {
    async evaluate() {
      return {
        allowed: true,
        code: 'AUTHORITY_SUFFICIENT',
        authority: {
          approverSubjectId: 'approver-1',
          roleKey: 'regional-approver',
          capturedAt: '2026-08-25T08:59:00.000Z',
          evidenceRefs: ['authority:1'],
        },
        sodEvidenceRefs: ['sod:1'],
      };
    },
  };
  let persistedEvidence: readonly string[] = [];
  const service = new AuthorityGatedWorkflowDecisionCaptureService(
    authority,
    decisions((value) => {
      assert.equal(value.decidedBySubjectId, 'approver-1');
      persistedEvidence = value.evidenceRefs;
    }),
  );

  const result = await service.capture(input);
  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(persistedEvidence, ['request:1', 'authority:1', 'sod:1']);
  if (result.status === 'COMMITTED') {
    assert.equal(result.authorityCode, 'AUTHORITY_SUFFICIENT');
    assert.deepEqual(result.sodEvidenceRefs, ['sod:1']);
  }
});
