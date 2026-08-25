import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowStageDecisionCommitResult,
  WorkflowStageDecisionRecord,
  WorkflowStageDecisionRepository,
} from '../src/index.ts';

class MemoryDecisionRepository implements WorkflowStageDecisionRepository {
  #stored: WorkflowStageDecisionRecord | null = null;

  async resolve() {
    if (this.#stored === null) return null;
    return {
      stageKey: this.#stored.stageKey,
      status: 'RECORDED' as const,
      decisionId: this.#stored.decisionId,
      outcome: this.#stored.outcome,
      decidedBySubjectId: this.#stored.decidedBySubjectId,
      decidedAt: this.#stored.decidedAt,
      code: this.#stored.code,
      evidenceRefs: [...this.#stored.evidenceRefs],
    };
  }

  async record(input: WorkflowStageDecisionRecord): Promise<WorkflowStageDecisionCommitResult> {
    const existing = await this.resolve({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      workTypeKey: input.workTypeKey,
      stageKey: input.stageKey,
    });
    if (existing !== null) {
      if (existing.decisionId === input.decisionId) {
        return { status: 'ALREADY_RECORDED', decision: existing };
      }
      return { status: 'CONFLICT', existing };
    }
    this.#stored = input;
    return { status: 'COMMITTED', decision: (await this.resolve({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      workTypeKey: input.workTypeKey,
      stageKey: input.stageKey,
    }))! };
  }
}

const record: WorkflowStageDecisionRecord = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  stageKey: 'decision',
  decisionId: 'decision-1',
  outcome: 'APPROVED',
  decidedBySubjectId: 'subject-1',
  decidedAt: '2026-08-25T08:30:00.000Z',
  code: 'APPROVED_BY_AUTHORITY',
  evidenceRefs: ['approval:1'],
};

test('decision repository contract supports commit, exact replay, and immutable conflict', async () => {
  const repository = new MemoryDecisionRepository();

  assert.equal((await repository.record(record)).status, 'COMMITTED');
  assert.equal((await repository.record(record)).status, 'ALREADY_RECORDED');

  const conflict = await repository.record({
    ...record,
    decisionId: 'decision-2',
    outcome: 'REJECTED',
  });
  assert.equal(conflict.status, 'CONFLICT');
  if (conflict.status === 'CONFLICT') {
    assert.equal(conflict.existing.outcome, 'APPROVED');
  }
});
