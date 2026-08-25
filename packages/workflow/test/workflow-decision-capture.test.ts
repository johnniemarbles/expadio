import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowDecisionCaptureInput,
  WorkflowDecisionCaptureService,
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
  evidenceRefs: ['approval:1'],
};

test('decision capture contract separates authority denial from immutable persistence outcomes', async () => {
  const service: WorkflowDecisionCaptureService = {
    async capture(value) {
      assert.equal(value.approverSubjectId, 'approver-1');
      return {
        status: 'AUTHORITY_DENIED',
        code: 'AUTHORITY_THRESHOLD_EXCEEDED',
        reason: 'Required authority exceeds approver threshold.',
        evidenceRefs: ['authority:1'],
      };
    },
  };

  const result = await service.capture(input);
  assert.equal(result.status, 'AUTHORITY_DENIED');
});
