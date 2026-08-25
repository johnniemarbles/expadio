import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowApprovalAuthorityContext,
  WorkflowApprovalAuthorityProvider,
} from '../src/index.ts';

const context: WorkflowApprovalAuthorityContext = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  stageKey: 'decision',
  proposedOutcome: 'APPROVED',
  requestedBySubjectId: 'requester-1',
  approverSubjectId: 'approver-1',
  requirements: [
    {
      dimensionKey: 'deal-value',
      requiredValue: 50000,
      unit: 'USD',
      scopeType: 'TERRITORY',
      scopeEntityId: 'territory-1',
    },
  ],
};

test('approval authority contract carries thresholds, delegation and SoD evidence without granting rights', async () => {
  const provider: WorkflowApprovalAuthorityProvider = {
    async evaluate(input) {
      assert.equal(input.requirements[0]?.dimensionKey, 'deal-value');
      return {
        allowed: true,
        code: 'AUTHORITY_SUFFICIENT',
        authority: {
          approverSubjectId: input.approverSubjectId,
          roleKey: 'regional-approver',
          delegatedFromSubjectId: 'director-1',
          capturedAt: '2026-08-25T08:50:00.000Z',
          evidenceRefs: ['authority-snapshot:1'],
        },
        sodEvidenceRefs: ['sod-check:1'],
      };
    },
  };

  const decision = await provider.evaluate(context);
  assert.equal(decision.allowed, true);
  if (decision.allowed) {
    assert.equal(decision.authority.delegatedFromSubjectId, 'director-1');
    assert.deepEqual(decision.sodEvidenceRefs, ['sod-check:1']);
  }
});
