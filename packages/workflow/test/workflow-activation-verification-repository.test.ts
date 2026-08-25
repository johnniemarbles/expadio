import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationVerificationRecord,
  WorkflowActivationVerificationRepository,
} from '../src/index.ts';

const verification: WorkflowActivationVerificationRecord = {
  verificationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  state: 'VERIFIED',
  assessments: [
    { dimension: 'AGREEMENT', outcome: 'SATISFIED', reason: 'Current.', evidenceRefs: ['agreement:1'] },
    { dimension: 'RIGHTS', outcome: 'SATISFIED', reason: 'Active.', evidenceRefs: ['rights:1'] },
    { dimension: 'ACCESS', outcome: 'SATISFIED', reason: 'Tested.', evidenceRefs: ['access:1'] },
    { dimension: 'COMPLIANCE', outcome: 'SATISFIED', reason: 'Passed.', evidenceRefs: ['compliance:1'] },
    { dimension: 'OPERATIONAL_READINESS', outcome: 'SATISFIED', reason: 'Ready.', evidenceRefs: ['readiness:1'] },
  ],
  verifiedBySubjectId: 'verifier-1',
  verifiedAt: '2026-08-25T13:30:00.000Z',
  reason: 'All independent controls passed.',
  evidenceRefs: ['verification-pack:1'],
};

class MemoryRepository implements WorkflowActivationVerificationRepository {
  readonly records = new Map<string, WorkflowActivationVerificationRecord>();

  async find(input: { tenantId: string; verificationId: string }) {
    return this.records.get(`${input.tenantId}:${input.verificationId}`) ?? null;
  }

  async record(input: WorkflowActivationVerificationRecord) {
    const key = `${input.tenantId}:${input.verificationId}`;
    const existing = this.records.get(key);
    if (existing === undefined) {
      this.records.set(key, structuredClone(input));
      return { status: 'COMMITTED' as const, verification: input };
    }
    return JSON.stringify(existing) === JSON.stringify(input)
      ? { status: 'ALREADY_RECORDED' as const, verification: existing }
      : { status: 'CONFLICT' as const, existing };
  }
}

test('records one immutable verification fact', async () => {
  const repository = new MemoryRepository();
  const result = await repository.record(verification);
  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(await repository.find({
    tenantId: verification.tenantId,
    verificationId: verification.verificationId,
  }), verification);
});

test('maps exact retries without overwriting the audit fact', async () => {
  const repository = new MemoryRepository();
  await repository.record(verification);
  const result = await repository.record(structuredClone(verification));
  assert.equal(result.status, 'ALREADY_RECORDED');
});

test('rejects changed content for the same tenant verification identity', async () => {
  const repository = new MemoryRepository();
  await repository.record(verification);
  const result = await repository.record({ ...verification, state: 'FAILED' });
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.existing.state, 'VERIFIED');
});

test('tenant identity participates in repository lookup', async () => {
  const repository = new MemoryRepository();
  await repository.record(verification);
  assert.equal(await repository.find({
    tenantId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    verificationId: verification.verificationId,
  }), null);
});
