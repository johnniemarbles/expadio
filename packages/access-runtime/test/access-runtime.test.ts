import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizePersistedAccess } from '../src/index.ts';

const context = {
  subjectId: 'user-123',
  actorKind: 'user' as const,
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-1111-1111-111111111111',
};

const query = {
  action: 'send',
  intent: 'act' as const,
  resource: {
    type: 'message',
    id: 'message-1',
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  },
};

test('does not load capability state when actor authorization is denied', async () => {
  let capabilityReads = 0;
  const decision = await authorizePersistedAccess(
    {
      authorizationPolicyRepository: {
        async loadPolicy() {
          return { assignments: [], restrictions: [] };
        },
      },
      capabilityAvailabilityRepository: {
        async loadCapabilityState() {
          capabilityReads += 1;
          return null;
        },
      },
    },
    {
      context,
      query,
      requiredCapabilityKey: 'email.delivery',
    },
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonKey, 'CAPABILITY_NOT_GRANTED');
  assert.equal(capabilityReads, 0);
});

test('denies an authorized actor when required capability is suspended', async () => {
  const decision = await authorizePersistedAccess(
    {
      authorizationPolicyRepository: {
        async loadPolicy() {
          return {
            assignments: [{
              roleKey: 'MESSAGING_OPERATOR',
              capabilities: [{ action: 'send', resourceType: 'message' }],
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
            state: 'SUSPENDED',
            reasonKey: 'BOUND_VIOLATION_GRACE_EXPIRED',
            blockingStepKey: 'UPDATE_SETTINGS',
            blockingBoundKey: 'REGION',
            ifYouDoNothing: ['Capability remains suspended.'],
          };
        },
      },
    },
    {
      context,
      query,
      requiredCapabilityKey: 'email.delivery',
    },
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.stage, 'PLATFORM_CAPABILITY');
  assert.equal(decision.capabilityState, 'SUSPENDED');
  assert.equal(decision.reasonKey, 'BOUND_VIOLATION_GRACE_EXPIRED');
});

test('missing required capability binding fails closed as not configured', async () => {
  const decision = await authorizePersistedAccess(
    {
      authorizationPolicyRepository: {
        async loadPolicy() {
          return {
            assignments: [{
              roleKey: 'MESSAGING_OPERATOR',
              capabilities: [{ action: 'send', resourceType: 'message' }],
              actionScope: { tenantId: context.tenantId },
            }],
            restrictions: [],
          };
        },
      },
      capabilityAvailabilityRepository: {
        async loadCapabilityState() {
          return null;
        },
      },
    },
    {
      context,
      query,
      requiredCapabilityKey: 'email.delivery',
    },
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.capabilityState, 'NOT_CONFIGURED');
  assert.equal(decision.reasonKey, 'CAPABILITY_BINDING_NOT_FOUND');
});
