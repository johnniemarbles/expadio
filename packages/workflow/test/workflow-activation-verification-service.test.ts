import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationRecord,
  WorkflowActivationRepository,
  WorkflowActivationVerificationRecord,
  WorkflowActivationVerificationRepository,
  WorkflowActivationVerificationRequest,
} from '../src/index.ts';
import { RepositoryWorkflowActivationVerificationService } from '../src/index.ts';

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
  provisionedResourceRefs: ['workspace:1'],
  startedAt: '2026-08-25T13:00:00.000Z',
  verificationEvidenceRefs: ['activation:1'],
};

const request: WorkflowActivationVerificationRequest = {
  verificationId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  tenantId: activation.tenantId,
  instanceId: activation.instanceId,
  activationId: activation.activationId,
  assessments: [
    { dimension: 'AGREEMENT', outcome: 'SATISFIED', reason: 'Current.', evidenceRefs: ['agreement:1'] },
    { dimension: 'RIGHTS', outcome: 'SATISFIED', reason: 'Active.', evidenceRefs: ['rights:1'] },
    { dimension: 'ACCESS', outcome: 'SATISFIED', reason: 'Tested.', evidenceRefs: ['access:1'] },
    { dimension: 'COMPLIANCE', outcome: 'SATISFIED', reason: 'Passed.', evidenceRefs: ['compliance:1'] },
    { dimension: 'OPERATIONAL_READINESS', outcome: 'SATISFIED', reason: 'Ready.', evidenceRefs: ['readiness:1'] },
  ],
  verifiedBySubjectId: 'verifier-1',
  verifiedAt: '2026-08-25T13:30:00.000Z',
  reason: 'Independent controls completed.',
  evidenceRefs: ['verification-pack:1'],
};

class ActivationRepository implements WorkflowActivationRepository {
  value: WorkflowActivationRecord | null = activation;
  async find() { return this.value; }
  async record(value: WorkflowActivationRecord) {
    return { status: 'COMMITTED' as const, activation: value };
  }
}

class VerificationRepository implements WorkflowActivationVerificationRepository {
  recorded: WorkflowActivationVerificationRecord | null = null;
  mode: 'COMMITTED' | 'ALREADY_RECORDED' | 'CONFLICT' = 'COMMITTED';
  async find() { return this.recorded; }
  async record(value: WorkflowActivationVerificationRecord) {
    this.recorded = value;
    if (this.mode === 'CONFLICT') {
      return { status: 'CONFLICT' as const, existing: { ...value, state: 'FAILED' as const } };
    }
    return this.mode === 'ALREADY_RECORDED'
      ? { status: 'ALREADY_RECORDED' as const, verification: value }
      : { status: 'COMMITTED' as const, verification: value };
  }
}

function service(input: {
  activations?: ActivationRepository;
  verifications?: VerificationRepository;
} = {}) {
  return new RepositoryWorkflowActivationVerificationService({
    activations: input.activations ?? new ActivationRepository(),
    verifications: input.verifications ?? new VerificationRepository(),
  });
}

test('derives VERIFIED and records a separate immutable fact', async () => {
  const verifications = new VerificationRepository();
  const result = await service({ verifications }).verify(request);
  assert.equal(result.status, 'RECORDED');
  assert.equal(verifications.recorded?.state, 'VERIFIED');
  assert.equal(verifications.recorded?.activationId, activation.activationId);
});

test('derives FAILED when any independent assessment is not satisfied', async () => {
  const verifications = new VerificationRepository();
  await service({ verifications }).verify({
    ...request,
    assessments: request.assessments.map((entry) =>
      entry.dimension === 'ACCESS'
        ? { ...entry, outcome: 'NOT_SATISFIED', reason: 'Access failed.' }
        : entry
    ),
  });
  assert.equal(verifications.recorded?.state, 'FAILED');
});

test('fails closed for absent, mismatched, or not-yet-started activation', async () => {
  const activations = new ActivationRepository();
  activations.value = null;
  let result = await service({ activations }).verify(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_NOT_FOUND');

  activations.value = { ...activation, instanceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' };
  result = await service({ activations }).verify(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_VERIFICATION_INSTANCE_MISMATCH');

  activations.value = { ...activation, startedAt: '2026-08-25T14:00:00.000Z' };
  result = await service({ activations }).verify(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_VERIFICATION_BEFORE_START');
});

test('does not persist malformed verification packs', async () => {
  const verifications = new VerificationRepository();
  const result = await service({ verifications }).verify({
    ...request,
    assessments: request.assessments.slice(1),
  });
  assert.equal(result.status, 'DENIED');
  assert.equal(verifications.recorded, null);
});

test('maps immutable retries and conflicts', async () => {
  const verifications = new VerificationRepository();
  const verificationService = service({ verifications });

  verifications.mode = 'ALREADY_RECORDED';
  assert.equal((await verificationService.verify(request)).status, 'ALREADY_RECORDED');

  verifications.mode = 'CONFLICT';
  assert.equal((await verificationService.verify(request)).status, 'CONFLICT');
});
