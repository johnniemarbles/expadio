import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAndPersistCapabilityState,
  type CapabilityBindingRecord,
  type CapabilityStateCommit,
  type CapabilityStateRepository,
  type CapabilityStateSnapshot,
} from '../src/index.ts';

class MemoryRepository implements CapabilityStateRepository {
  snapshot: CapabilityStateSnapshot | null = null;
  commits: CapabilityStateCommit[] = [];

  async load(tenantId: string, bindingId: string): Promise<CapabilityStateSnapshot | null> {
    if (this.snapshot?.tenantId === tenantId && this.snapshot.bindingId === bindingId) return this.snapshot;
    return null;
  }

  async commit(change: CapabilityStateCommit): Promise<void> {
    const actualVersion = this.snapshot?.version ?? null;
    if (actualVersion !== change.expectedVersion) throw new Error('optimistic concurrency conflict');
    this.commits.push(change);
    this.snapshot = change.snapshot;
  }
}

function binding(overrides: Partial<CapabilityBindingRecord> = {}): CapabilityBindingRecord {
  return {
    bindingId: 'binding-1',
    tenantId: 'tenant-a',
    capabilityKey: 'email.delivery',
    mode: 'A',
    permittedModes: ['A', 'B'],
    proofs: [],
    isEntitled: true,
    isWithinBounds: true,
    ...overrides,
  };
}

test('first resolution persists snapshot and transition event atomically', async () => {
  const repository = new MemoryRepository();
  const result = await resolveAndPersistCapabilityState(
    repository,
    binding(),
    new Date('2026-08-25T00:00:00.000Z'),
  );

  assert.equal(result.snapshot.state, 'PLATFORM_DEFAULT');
  assert.equal(result.snapshot.version, 1);
  assert.equal(result.transitioned, true);
  assert.equal(repository.commits[0]?.event?.fromState, null);
  assert.equal(repository.commits[0]?.event?.toState, 'PLATFORM_DEFAULT');
});

test('identical normalized input is idempotent and creates no new commit', async () => {
  const repository = new MemoryRepository();
  await resolveAndPersistCapabilityState(repository, binding({ permittedModes: ['B', 'A'] }));
  const second = await resolveAndPersistCapabilityState(repository, binding({ permittedModes: ['A', 'B'] }));

  assert.equal(second.changed, false);
  assert.equal(repository.commits.length, 1);
});

test('input change without effective state transition updates snapshot but does not create state event', async () => {
  const repository = new MemoryRepository();
  await resolveAndPersistCapabilityState(repository, binding());
  const second = await resolveAndPersistCapabilityState(
    repository,
    binding({ capabilityKey: 'email.delivery.v2' }),
  );

  assert.equal(second.snapshot.state, 'PLATFORM_DEFAULT');
  assert.equal(second.changed, true);
  assert.equal(second.transitioned, false);
  assert.equal(repository.commits[1]?.event, null);
});

test('effective state transition records prior and next state', async () => {
  const repository = new MemoryRepository();
  await resolveAndPersistCapabilityState(repository, binding());
  await resolveAndPersistCapabilityState(
    repository,
    binding({ isWithinBounds: false, boundViolationKey: 'daily_limit' }),
  );

  assert.equal(repository.commits[1]?.event?.fromState, 'PLATFORM_DEFAULT');
  assert.equal(repository.commits[1]?.event?.toState, 'VIOLATING');
});
