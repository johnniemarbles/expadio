import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationRecord,
  WorkflowActivationRepository,
} from '../src/index.ts';

const activation: WorkflowActivationRecord = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  activationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  blueprintKey: 'partner-activation',
  blueprintVersion: 1,
  provisioningModel: 'SCOPED_WORKSPACE',
  sourceRightsGrantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
  verificationState: 'NOT_VERIFIED',
  provisionedResourceRefs: [],
  startedAt: '2026-08-25T12:35:00.000Z',
  verificationEvidenceRefs: [],
};

class InMemoryRepository implements WorkflowActivationRepository {
  #current: WorkflowActivationRecord | null = null;

  async find(input: { readonly tenantId: string; readonly activationId: string }) {
    if (
      this.#current?.tenantId === input.tenantId
      && this.#current.activationId === input.activationId
    ) return this.#current;
    return null;
  }

  async record(next: WorkflowActivationRecord) {
    if (this.#current === null) {
      this.#current = next;
      return { status: 'COMMITTED' as const, activation: next };
    }
    if (JSON.stringify(this.#current) === JSON.stringify(next)) {
      return { status: 'ALREADY_RECORDED' as const, activation: this.#current };
    }
    return { status: 'CONFLICT' as const, existing: this.#current };
  }
}

test('repository port supports exact activation replay', async () => {
  const repository = new InMemoryRepository();
  assert.equal((await repository.record(activation)).status, 'COMMITTED');
  assert.equal((await repository.record(activation)).status, 'ALREADY_RECORDED');
  assert.deepEqual(await repository.find({
    tenantId: activation.tenantId,
    activationId: activation.activationId,
  }), activation);
});

test('repository port preserves the first immutable activation on conflict', async () => {
  const repository = new InMemoryRepository();
  await repository.record(activation);
  const result = await repository.record({
    ...activation,
    provisioningModel: 'ACCOUNT_ONLY',
  });
  assert.equal(result.status, 'CONFLICT');
  if (result.status === 'CONFLICT') {
    assert.equal(result.existing.provisioningModel, 'SCOPED_WORKSPACE');
  }
});
