import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowConditionEvaluator,
  WorkflowConditionEvaluationContext,
} from '../src/index.ts';

const context: WorkflowConditionEvaluationContext = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: '11111111-1111-1111-1111-111111111111',
  workTypeKey: 'partner-onboarding',
  stageKey: 'qualification',
  phase: 'EXIT',
};

test('condition evaluator contract returns machine code plus opaque evidence refs', async () => {
  const evaluator: WorkflowConditionEvaluator = {
    async evaluate(input) {
      assert.equal(input.condition.type, 'minimum-score');
      assert.deepEqual(input.context, context);
      return {
        satisfied: true,
        code: 'CONDITION_SATISFIED',
        evidenceRefs: ['score-assessment:42'],
      };
    },
  };

  const result = await evaluator.evaluate({
    condition: { type: 'minimum-score', parameters: { threshold: 70 } },
    context,
  });

  assert.equal(result.satisfied, true);
  assert.equal(result.code, 'CONDITION_SATISFIED');
  assert.deepEqual(result.evidenceRefs, ['score-assessment:42']);
});
