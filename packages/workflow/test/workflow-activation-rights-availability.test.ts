import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationLifecycleRepository,
  WorkflowActivationRecord,
  WorkflowActivationRepository,
} from '../src/index.ts';
import { RepositoryWorkflowActivationRightsAvailabilityProvider } from '../src/index.ts';

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

const request = {
  tenantId: activation.tenantId,
  instanceId: activation.instanceId,
  activationId: activation.activationId,
  rightsGrantId: activation.sourceRightsGrantIds[0]!,
};

class ActivationRepository implements WorkflowActivationRepository {
  value: WorkflowActivationRecord | null = activation;
  async find() { return this.value; }
  async record(value: WorkflowActivationRecord) {
    return { status: 'COMMITTED' as const, activation: value };
  }
}

class LifecycleRepository implements WorkflowActivationLifecycleRepository {
  state: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null = 'ACTIVE';
  reads = 0;
  async findEvent() { return null; }
  async currentState() {
    this.reads += 1;
    return this.state;
  }
  async append(value: Parameters<WorkflowActivationLifecycleRepository['append']>[0]) {
    return { status: 'COMMITTED' as const, event: value };
  }
}

function provider(input: {
  activations?: ActivationRepository;
  lifecycle?: LifecycleRepository;
} = {}) {
  return new RepositoryWorkflowActivationRightsAvailabilityProvider({
    activations: input.activations ?? new ActivationRepository(),
    lifecycle: input.lifecycle ?? new LifecycleRepository(),
  });
}

test('makes verified ACTIVE activation rights available', async () => {
  const result = await provider().evaluate(request);

  assert.deepEqual(result, {
    available: true,
    state: 'ACTIVE',
    code: 'ACTIVATION_RIGHTS_ACTIVE',
    evidenceRefs: [
      `activation:${activation.activationId}`,
      `rights-grant:${request.rightsGrantId}`,
    ],
  });
});

test('fails closed before lifecycle reads for absent or mismatched provenance', async () => {
  const activations = new ActivationRepository();
  const lifecycle = new LifecycleRepository();

  activations.value = null;
  let result = await provider({ activations, lifecycle }).evaluate(request);
  assert.equal(result.available, false);
  assert.equal(result.code, 'ACTIVATION_NOT_FOUND');

  activations.value = {
    ...activation,
    instanceId: '99999999-9999-9999-9999-999999999999',
  };
  result = await provider({ activations, lifecycle }).evaluate(request);
  assert.equal(result.code, 'ACTIVATION_RIGHTS_INSTANCE_MISMATCH');

  activations.value = activation;
  result = await provider({ activations, lifecycle }).evaluate({
    ...request,
    rightsGrantId: '99999999-9999-9999-9999-999999999999',
  });
  assert.equal(result.code, 'ACTIVATION_RIGHTS_PROVENANCE_MISMATCH');
  assert.equal(lifecycle.reads, 0);
});

test('denies rights when activation has no verified lifecycle bootstrap', async () => {
  const lifecycle = new LifecycleRepository();
  lifecycle.state = null;

  const result = await provider({ lifecycle }).evaluate(request);

  assert.equal(result.available, false);
  assert.equal(result.code, 'ACTIVATION_RIGHTS_NOT_VERIFIED');
});

test('denies suspended and terminally revoked activation rights', async () => {
  const lifecycle = new LifecycleRepository();
  lifecycle.state = 'SUSPENDED';
  let result = await provider({ lifecycle }).evaluate(request);
  assert.deepEqual(
    { available: result.available, code: result.code, state: result.state },
    {
      available: false,
      code: 'ACTIVATION_RIGHTS_SUSPENDED',
      state: 'SUSPENDED',
    },
  );

  lifecycle.state = 'REVOKED';
  result = await provider({ lifecycle }).evaluate(request);
  assert.deepEqual(
    { available: result.available, code: result.code, state: result.state },
    {
      available: false,
      code: 'ACTIVATION_RIGHTS_REVOKED',
      state: 'REVOKED',
    },
  );
});
