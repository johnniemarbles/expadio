import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOperationalState,
  resolveCapabilityState,
  type CapabilityStateInput,
} from '../src/index.ts';

function input(overrides: Partial<CapabilityStateInput> = {}): CapabilityStateInput {
  return {
    capabilityKey: 'email_delivery',
    mode: 'B',
    permittedModes: ['A', 'B', 'C', 'D'],
    proofs: [],
    isEntitled: true,
    isWithinBounds: true,
    ...overrides,
  };
}

test('locks before provider state when the plan does not entitle the capability', () => {
  const result = resolveCapabilityState(input({ isEntitled: false }));
  assert.equal(result.state, 'LOCKED_BY_PLAN');
  assert.equal(result.blockingStepKey, 'UPGRADE_PLAN');
});

test('marks an in-grace bound violation as violating', () => {
  const result = resolveCapabilityState(
    input({
      isWithinBounds: false,
      boundViolationKey: 'data_residency',
      graceExpiresAt: new Date('2026-08-25T00:00:00Z'),
    }),
    new Date('2026-08-24T00:00:00Z'),
  );
  assert.equal(result.state, 'VIOLATING');
  assert.equal(result.blockingBoundKey, 'data_residency');
});

test('suspends after the violation grace period expires', () => {
  const result = resolveCapabilityState(
    input({
      isWithinBounds: false,
      graceExpiresAt: new Date('2026-08-25T00:00:00Z'),
    }),
    new Date('2026-08-26T00:00:00Z'),
  );
  assert.equal(result.state, 'SUSPENDED');
});

test('requires a selected and permitted mode', () => {
  assert.equal(resolveCapabilityState(input({ mode: null })).reasonKey, 'MISSING_MODE');
  assert.equal(
    resolveCapabilityState(input({ mode: 'D', permittedModes: ['A', 'B'] })).reasonKey,
    'MODE_NOT_PERMITTED',
  );
});

test('mode A resolves to platform default without customer proofs', () => {
  const result = resolveCapabilityState(
    input({ mode: 'A', proofs: [{ proofKey: 'x', status: 'FAILED' }] }),
  );
  assert.equal(result.state, 'PLATFORM_DEFAULT');
});

test('all matched proofs activate a non-default capability', () => {
  const result = resolveCapabilityState(
    input({ proofs: [{ proofKey: 'credential', status: 'MATCHED' }] }),
  );
  assert.equal(result.state, 'ACTIVE');
});

test('partial proof coverage degrades but remains operational', () => {
  const result = resolveCapabilityState(
    input({
      proofs: [
        { proofKey: 'credential', status: 'MATCHED' },
        { proofKey: 'residency', status: 'FAILED' },
      ],
    }),
  );
  assert.equal(result.state, 'DEGRADED');
  assert.equal(isOperationalState(result.state), true);
});

test('pending and failed proof sets remain non-operational', () => {
  const pending = resolveCapabilityState(
    input({ proofs: [{ proofKey: 'credential', status: 'PENDING' }] }),
  );
  assert.equal(pending.state, 'PENDING_PROOF');
  assert.equal(isOperationalState(pending.state), false);

  const failed = resolveCapabilityState(
    input({ proofs: [{ proofKey: 'credential', status: 'FAILED' }] }),
  );
  assert.equal(failed.reasonKey, 'PROOFS_FAILED');
});
