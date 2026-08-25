import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowTransitionAuthorizationContext,
  WorkflowTransitionAuthorizationProvider,
} from '../src/index.ts';

const context: WorkflowTransitionAuthorizationContext = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: '11111111-1111-1111-1111-111111111111',
  workTypeKey: 'partner-onboarding',
  actorSubjectId: 'subject-1',
  fromStageKey: 'qualification',
  toStageKey: 'review',
  action: 'workflow.transition',
};

test('authorization provider receives workflow transition context without role/policy coupling', async () => {
  let received: WorkflowTransitionAuthorizationContext | undefined;
  const provider: WorkflowTransitionAuthorizationProvider = {
    async authorize(input) {
      received = input;
      return {
        allowed: true,
        code: 'WORKFLOW_AUTHORIZATION_GRANTED',
        evidenceRefs: ['authorization:decision-1'],
      };
    },
  };

  const result = await provider.authorize(context);
  assert.deepEqual(received, context);
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'WORKFLOW_AUTHORIZATION_GRANTED');
});
