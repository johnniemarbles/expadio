import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationLifecycleEvent,
  WorkflowActivationLifecycleRepository,
  WorkflowActivationLifecycleRequest,
  WorkflowActivationRecord,
  WorkflowActivationRepository,
  WorkflowActivationVerificationRecord,
  WorkflowActivationVerificationRepository,
} from '../src/index.ts';
import { RepositoryWorkflowActivationLifecycleService } from '../src/index.ts';

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

const verification: WorkflowActivationVerificationRecord = {
  verificationId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  tenantId: activation.tenantId,
  instanceId: activation.instanceId,
  activationId: activation.activationId,
  state: 'VERIFIED',
  assessments: [],
  verifiedBySubjectId: 'verifier-1',
  verifiedAt: '2026-08-25T13:30:00.000Z',
  reason: 'Verified.',
  evidenceRefs: ['verification:1'],
};

const request: WorkflowActivationLifecycleRequest = {
  eventId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  tenantId: activation.tenantId,
  instanceId: activation.instanceId,
  activationId: activation.activationId,
  expectedFromState: 'ACTIVE',
  action: 'SUSPEND',
  affectedRightsGrantIds: activation.sourceRightsGrantIds,
  monitoringTriggerKey: 'standing-control:insurance',
  sourceVerificationId: verification.verificationId,
  performedBySubjectId: 'monitor-1',
  performedAt: '2026-08-25T14:00:00.000Z',
  reason: 'Insurance evidence expired.',
  evidenceRefs: ['monitoring:1'],
};

const expectedEvent: WorkflowActivationLifecycleEvent = {
  eventId: request.eventId,
  tenantId: request.tenantId,
  instanceId: request.instanceId,
  activationId: request.activationId,
  fromState: request.expectedFromState,
  toState: 'SUSPENDED',
  action: request.action,
  affectedRightsGrantIds: request.affectedRightsGrantIds,
  monitoringTriggerKey: request.monitoringTriggerKey,
  sourceVerificationId: verification.verificationId,
  performedBySubjectId: request.performedBySubjectId,
  performedAt: request.performedAt,
  reason: request.reason,
  evidenceRefs: request.evidenceRefs,
};

class ActivationRepository implements WorkflowActivationRepository {
  value: WorkflowActivationRecord | null = activation;
  async find() { return this.value; }
  async record(value: WorkflowActivationRecord) {
    return { status: 'COMMITTED' as const, activation: value };
  }
}

class VerificationRepository implements WorkflowActivationVerificationRepository {
  value: WorkflowActivationVerificationRecord | null = verification;
  async find() { return this.value; }
  async record(value: WorkflowActivationVerificationRecord) {
    return { status: 'COMMITTED' as const, verification: value };
  }
}

class LifecycleRepository implements WorkflowActivationLifecycleRepository {
  existing: WorkflowActivationLifecycleEvent | null = null;
  state: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null = 'ACTIVE';
  recorded: WorkflowActivationLifecycleEvent | null = null;
  mode: 'COMMITTED' | 'ALREADY_RECORDED' | 'EVENT_CONFLICT' | 'STATE_CONFLICT' =
    'COMMITTED';

  async findEvent() { return this.existing; }
  async currentState() { return this.state; }
  async append(value: WorkflowActivationLifecycleEvent) {
    this.recorded = value;
    switch (this.mode) {
      case 'COMMITTED':
        return { status: 'COMMITTED' as const, event: value };
      case 'ALREADY_RECORDED':
        return { status: 'ALREADY_RECORDED' as const, event: value };
      case 'EVENT_CONFLICT':
        return {
          status: 'EVENT_CONFLICT' as const,
          existing: { ...value, reason: 'Different.' },
        };
      case 'STATE_CONFLICT':
        return { status: 'STATE_CONFLICT' as const, currentState: 'SUSPENDED' as const };
    }
  }
}

function service(input: {
  activations?: ActivationRepository;
  verifications?: VerificationRepository;
  lifecycle?: LifecycleRepository;
} = {}) {
  return new RepositoryWorkflowActivationLifecycleService({
    activations: input.activations ?? new ActivationRepository(),
    verifications: input.verifications ?? new VerificationRepository(),
    lifecycle: input.lifecycle ?? new LifecycleRepository(),
  });
}

test('applies a scoped lifecycle event without rewriting activation or rights', async () => {
  const lifecycle = new LifecycleRepository();
  const result = await service({ lifecycle }).apply(request);

  assert.equal(result.status, 'APPLIED');
  assert.deepEqual(lifecycle.recorded, expectedEvent);
});

test('returns ALREADY_APPLIED for an exact retry even after state advances', async () => {
  const lifecycle = new LifecycleRepository();
  lifecycle.existing = expectedEvent;
  lifecycle.state = 'SUSPENDED';

  const result = await service({ lifecycle }).apply(request);

  assert.equal(result.status, 'ALREADY_APPLIED');
  assert.equal(lifecycle.recorded, null);
});

test('rejects malformed requests before repository mutation', async () => {
  const lifecycle = new LifecycleRepository();
  const result = await service({ lifecycle }).apply({
    ...request,
    affectedRightsGrantIds: [],
  });

  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_RIGHTS_REQUIRED');
  assert.equal(lifecycle.recorded, null);
});

test('fails closed for absent or mismatched activation scope', async () => {
  const activations = new ActivationRepository();
  activations.value = null;
  let result = await service({ activations }).apply(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_NOT_FOUND');

  activations.value = {
    ...activation,
    instanceId: '99999999-9999-9999-9999-999999999999',
  };
  result = await service({ activations }).apply(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_INSTANCE_MISMATCH');
});

test('rejects rights outside the immutable activation provenance', async () => {
  const result = await service().apply({
    ...request,
    affectedRightsGrantIds: ['99999999-9999-9999-9999-999999999999'],
  });

  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_RIGHTS_MISMATCH');
});

test('validates optional source verification ownership and chronology', async () => {
  const verifications = new VerificationRepository();
  verifications.value = null;
  let result = await service({ verifications }).apply(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_VERIFICATION_NOT_FOUND');

  verifications.value = {
    ...verification,
    activationId: '99999999-9999-9999-9999-999999999999',
  };
  result = await service({ verifications }).apply(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_VERIFICATION_MISMATCH');

  verifications.value = { ...verification, verifiedAt: '2026-08-25T15:00:00.000Z' };
  result = await service({ verifications }).apply(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_VERIFICATION_AFTER_EVENT');
});

test('fails closed when activation is unverified and reports stale state', async () => {
  const lifecycle = new LifecycleRepository();
  lifecycle.state = null;
  let result = await service({ lifecycle }).apply(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_LIFECYCLE_NOT_VERIFIED');

  lifecycle.state = 'SUSPENDED';
  result = await service({ lifecycle }).apply(request);
  assert.deepEqual(result, { status: 'CONFLICT', currentState: 'SUSPENDED' });
});

test('maps repository races and immutable event conflicts', async () => {
  const lifecycle = new LifecycleRepository();
  lifecycle.mode = 'ALREADY_RECORDED';
  assert.equal((await service({ lifecycle }).apply(request)).status, 'ALREADY_APPLIED');

  lifecycle.mode = 'STATE_CONFLICT';
  assert.deepEqual(await service({ lifecycle }).apply(request), {
    status: 'CONFLICT',
    currentState: 'SUSPENDED',
  });

  lifecycle.mode = 'EVENT_CONFLICT';
  const conflict = await service({ lifecycle }).apply(request);
  assert.equal(conflict.status, 'DENIED');
  assert.equal(conflict.code, 'ACTIVATION_LIFECYCLE_EVENT_CONFLICT');
});
