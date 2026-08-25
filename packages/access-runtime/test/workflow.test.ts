import assert from 'node:assert/strict';
import test from 'node:test';
import { PersistedWorkflowAuthorizationProvider } from '../src/workflow.ts';

const context = {
  subjectId: 'user-123',
  actorKind: 'user' as const,
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-1111-1111-111111111111',
};

const workflowInput = {
  tenantId: context.tenantId,
  instanceId: '22222222-2222-2222-2222-222222222222',
  workTypeKey: 'partner-onboarding',
  actorSubjectId: context.subjectId,
  fromStageKey: 'qualification',
  toStageKey: 'review',
  action: 'workflow.transition',
};

function dependencies() {
  return {
    authorizationPolicyRepository: {
      async loadPolicy() {
        return {
          assignments: [{
            roleKey: 'WORKFLOW_OPERATOR',
            capabilities: [{ action: 'workflow.transition', resourceType: 'WORKFLOW_INSTANCE' }],
            actionScope: {
              tenantId: context.tenantId,
              organizationIds: [context.organizationId],
            },
          }],
          restrictions: [],
        };
      },
    },
    capabilityAvailabilityRepository: {
      async loadCapabilityState() {
        return {
          state: 'ACTIVE' as const,
          reasonKey: 'READY',
          blockingStepKey: null,
          blockingBoundKey: null,
          ifYouDoNothing: [],
        };
      },
    },
  };
}

test('maps workflow transition into canonical persisted authorization', async () => {
  const provider = new PersistedWorkflowAuthorizationProvider({
    dependencies: dependencies(),
    effectiveContext: context,
  });

  const result = await provider.authorize(workflowInput);
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'GRANTED');
  assert.deepEqual(result.evidenceRefs, ['role:WORKFLOW_OPERATOR']);
});

test('rejects actor mismatch before loading persisted policy', async () => {
  let policyReads = 0;
  const deps = dependencies();
  const provider = new PersistedWorkflowAuthorizationProvider({
    dependencies: {
      ...deps,
      authorizationPolicyRepository: {
        async loadPolicy(input) {
          policyReads += 1;
          return deps.authorizationPolicyRepository.loadPolicy(input);
        },
      },
    },
    effectiveContext: context,
  });

  const result = await provider.authorize({
    ...workflowInput,
    actorSubjectId: 'other-user',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'ACTOR_SUBJECT_MISMATCH');
  assert.equal(policyReads, 0);
});

test('can apply an existing platform capability requirement without changing workflow policy', async () => {
  const provider = new PersistedWorkflowAuthorizationProvider({
    dependencies: dependencies(),
    effectiveContext: context,
    requiredCapabilityKey: 'workflow.execution',
  });

  const result = await provider.authorize(workflowInput);
  assert.equal(result.allowed, true);
  assert.equal(result.evidenceRefs.includes('capability:workflow.execution:ACTIVE'), true);
});
