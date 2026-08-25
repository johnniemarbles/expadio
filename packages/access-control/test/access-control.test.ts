import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthorizationInput } from '@expadio/authorization';
import { authorizeAccess, requiredPlatformCapability } from '../src/index.ts';

function authorization(overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    context: {
      subjectId: 'subject-1',
      actorKind: 'user',
      tenantId: 'tenant-a',
      organizationId: 'org-a',
    },
    query: {
      action: 'send',
      intent: 'act',
      resource: {
        type: 'message',
        id: 'message-1',
        tenantId: 'tenant-a',
        organizationId: 'org-a',
      },
    },
    assignments: [
      {
        roleKey: 'operator',
        capabilities: [{ action: 'send', resourceType: 'message' }],
        actionScope: { tenantId: 'tenant-a', organizationIds: ['org-a'] },
      },
    ],
    ...overrides,
  };
}

test('actor denial is returned before capability state is exposed', () => {
  const result = authorizeAccess({
    authorization: authorization({ assignments: [] }),
    requiredCapability: {
      capabilityKey: 'email.delivery',
      state: 'SUSPENDED',
      reasonKey: 'SECRET_TENANT_CONFIGURATION_REASON',
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.stage, 'CAPABILITY');
  assert.equal(result.reasonKey, 'CAPABILITY_NOT_GRANTED');
  assert.equal(result.capabilityKey, undefined);
  assert.equal(result.capabilityState, undefined);
});

test('active and platform-default capabilities preserve an authorization grant', () => {
  for (const state of ['ACTIVE', 'PLATFORM_DEFAULT'] as const) {
    const result = authorizeAccess({
      authorization: authorization(),
      requiredCapability: { capabilityKey: 'email.delivery', state },
    });
    assert.equal(result.allowed, true);
    assert.equal(result.reasonKey, 'GRANTED');
    assert.equal(result.capabilityState, state);
  }
});

test('degraded capability is operational by default and surfaced to caller', () => {
  const result = authorizeAccess({
    authorization: authorization(),
    requiredCapability: {
      capabilityKey: 'email.delivery',
      state: 'DEGRADED',
      reasonKey: 'PARTIAL_PROOFS',
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.degraded, true);
  assert.equal(result.capabilityState, 'DEGRADED');
});

test('full-readiness action can reject degraded capability', () => {
  const result = authorizeAccess({
    authorization: authorization(),
    requiredCapability: {
      capabilityKey: 'email.delivery',
      state: 'DEGRADED',
      reasonKey: 'PARTIAL_PROOFS',
      blockingStepKey: 'COMPLETE_PROOFS',
      degradedPolicy: 'DENY',
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.stage, 'PLATFORM_CAPABILITY');
  assert.equal(result.reasonKey, 'PARTIAL_PROOFS');
  assert.equal(result.blockingStepKey, 'COMPLETE_PROOFS');
});

test('non-operational states block an otherwise authorized request', () => {
  for (const state of [
    'PENDING_PROOF',
    'VIOLATING',
    'SUSPENDED',
    'LOCKED_BY_PLAN',
    'NOT_CONFIGURED',
  ] as const) {
    const result = authorizeAccess({
      authorization: authorization(),
      requiredCapability: { capabilityKey: 'email.delivery', state },
    });
    assert.equal(result.allowed, false, state);
    assert.equal(result.stage, 'PLATFORM_CAPABILITY', state);
    assert.equal(result.capabilityState, state);
  }
});

test('resolved Capability Fabric state maps directly into access requirement', () => {
  const requirement = requiredPlatformCapability('email.delivery', {
    state: 'SUSPENDED',
    reasonKey: 'BOUND_VIOLATION_GRACE_EXPIRED',
    blockingStepKey: 'UPDATE_SETTINGS',
    blockingBoundKey: 'daily_limit',
    ifYouDoNothing: ['Capability remains suspended.'],
  });

  assert.deepEqual(requirement, {
    capabilityKey: 'email.delivery',
    state: 'SUSPENDED',
    reasonKey: 'BOUND_VIOLATION_GRACE_EXPIRED',
    blockingStepKey: 'UPDATE_SETTINGS',
    degradedPolicy: 'ALLOW',
  });
});
