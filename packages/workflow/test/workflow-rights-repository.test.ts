import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowRightsGrant,
  WorkflowRightsGrantRepository,
} from '../src/index.ts';

const grant: WorkflowRightsGrant = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'distribution-onboarding',
  grantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  beneficiaryOrganizationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  profileKey: 'distribution-basic',
  profileVersion: 1,
  rightTypes: ['SELL'],
  scope: { territoryIds: ['north'] },
  effectiveFrom: '2026-08-25T09:00:00.000Z',
  sourceDecisionId: 'decision-1',
  grantedBySubjectId: 'subject-1',
  grantedAt: '2026-08-25T09:05:00.000Z',
  state: 'ACTIVE',
  evidenceRefs: ['decision:decision-1'],
};

class InMemoryRepository implements WorkflowRightsGrantRepository {
  #current: WorkflowRightsGrant | null = null;

  async find(input: { readonly tenantId: string; readonly grantId: string }) {
    if (
      this.#current?.tenantId === input.tenantId
      && this.#current.grantId === input.grantId
    ) return this.#current;
    return null;
  }

  async record(next: WorkflowRightsGrant) {
    if (this.#current === null) {
      this.#current = next;
      return { status: 'COMMITTED' as const, grant: next };
    }
    if (JSON.stringify(this.#current) === JSON.stringify(next)) {
      return { status: 'ALREADY_RECORDED' as const, grant: this.#current };
    }
    return { status: 'CONFLICT' as const, existing: this.#current };
  }
}

test('repository port supports exact idempotent replay', async () => {
  const repository = new InMemoryRepository();
  assert.equal((await repository.record(grant)).status, 'COMMITTED');
  assert.equal((await repository.record(grant)).status, 'ALREADY_RECORDED');
});

test('repository port preserves the first immutable grant on conflict', async () => {
  const repository = new InMemoryRepository();
  await repository.record(grant);
  const result = await repository.record({ ...grant, rightTypes: ['MARKET'] });

  assert.equal(result.status, 'CONFLICT');
  if (result.status === 'CONFLICT') {
    assert.deepEqual(result.existing.rightTypes, ['SELL']);
  }
});
