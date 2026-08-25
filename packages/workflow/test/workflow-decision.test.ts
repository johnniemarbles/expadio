import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowStageDecision,
  WorkflowStageDecisionProvider,
} from '../src/index.ts';

const recorded: WorkflowStageDecision = {
  stageKey: 'decision',
  status: 'RECORDED',
  decisionId: 'decision-1',
  outcome: 'APPROVED',
  decidedBySubjectId: 'subject-1',
  decidedAt: '2026-08-25T08:00:00.000Z',
  code: 'WORKFLOW_DECISION_RECORDED',
  evidenceRefs: ['decision:decision-1'],
};

test('decision provider exposes recorded outcome without embedding authority logic', async () => {
  const provider: WorkflowStageDecisionProvider = {
    async resolve() { return recorded; },
  };

  const result = await provider.resolve({
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    instanceId: '11111111-1111-1111-1111-111111111111',
    workTypeKey: 'partner-onboarding',
    stageKey: 'decision',
  });

  assert.equal(result?.status, 'RECORDED');
  assert.equal(result?.outcome, 'APPROVED');
  assert.equal(result?.decisionId, 'decision-1');
});
