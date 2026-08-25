import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationBlueprintDefinition,
  WorkflowActivationBlueprintProvider,
  WorkflowActivationRecord,
  WorkflowActivationRepository,
  WorkflowActivationRequest,
  WorkflowRightsGrant,
  WorkflowRightsGrantRepository,
} from '../src/index.ts';
import { RepositoryWorkflowActivationService } from '../src/index.ts';

const blueprint: WorkflowActivationBlueprintDefinition = {
  blueprintKey: 'partner-activation',
  version: 2,
  label: 'Partner activation',
  workTypeKey: 'partner-onboarding',
  provisioningModel: 'SCOPED_WORKSPACE',
  steps: [],
};

const request: WorkflowActivationRequest = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: blueprint.workTypeKey,
  activationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version },
  sourceRightsGrantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
  requestedBySubjectId: 'subject-1',
  requestedAt: '2026-08-25T12:30:00.000Z',
  evidenceRefs: ['rights-grant:dddddddd-dddd-dddd-dddd-dddddddddddd'],
};

const activeGrant: WorkflowRightsGrant = {
  tenantId: request.tenantId,
  instanceId: request.instanceId,
  workTypeKey: request.workTypeKey,
  grantId: request.sourceRightsGrantIds[0]!,
  beneficiaryOrganizationId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  profileKey: 'partner',
  profileVersion: 1,
  rightTypes: ['OPERATE'],
  scope: {},
  effectiveFrom: '2026-08-25T12:00:00.000Z',
  effectiveUntil: '2027-08-25T12:00:00.000Z',
  grantedBySubjectId: 'approver-1',
  grantedAt: '2026-08-25T12:00:00.000Z',
  state: 'ACTIVE',
  evidenceRefs: ['decision:1'],
};

class BlueprintProvider implements WorkflowActivationBlueprintProvider {
  value: WorkflowActivationBlueprintDefinition | null = blueprint;
  async resolve(): Promise<WorkflowActivationBlueprintDefinition | null> {
    return this.value;
  }
}

class RightsRepository implements WorkflowRightsGrantRepository {
  value: WorkflowRightsGrant | null = activeGrant;
  async find(): Promise<WorkflowRightsGrant | null> {
    return this.value;
  }
  async record(grant: WorkflowRightsGrant) {
    return { status: 'COMMITTED' as const, grant };
  }
}

class ActivationRepository implements WorkflowActivationRepository {
  recorded: WorkflowActivationRecord | null = null;
  mode: 'COMMITTED' | 'ALREADY_RECORDED' | 'CONFLICT' = 'COMMITTED';

  async find(): Promise<WorkflowActivationRecord | null> {
    return this.recorded;
  }

  async record(activation: WorkflowActivationRecord) {
    this.recorded = activation;
    if (this.mode === 'CONFLICT') {
      return { status: 'CONFLICT' as const, existing: { ...activation, blueprintVersion: 1 } };
    }
    return this.mode === 'ALREADY_RECORDED'
      ? { status: 'ALREADY_RECORDED' as const, activation }
      : { status: 'COMMITTED' as const, activation };
  }
}

function service(input: {
  rights?: RightsRepository;
  repository?: ActivationRepository;
  blueprints?: BlueprintProvider;
} = {}) {
  return new RepositoryWorkflowActivationService({
    blueprints: input.blueprints ?? new BlueprintProvider(),
    rights: input.rights ?? new RightsRepository(),
    repository: input.repository ?? new ActivationRepository(),
  });
}

test('pins blueprint and validated rights provenance without provisioning', async () => {
  const repository = new ActivationRepository();
  const result = await service({ repository }).activate(request);

  assert.equal(result.status, 'STARTED');
  assert.deepEqual(repository.recorded, {
    tenantId: request.tenantId,
    instanceId: request.instanceId,
    workTypeKey: request.workTypeKey,
    activationId: request.activationId,
    blueprintKey: blueprint.blueprintKey,
    blueprintVersion: blueprint.version,
    provisioningModel: blueprint.provisioningModel,
    sourceRightsGrantIds: request.sourceRightsGrantIds,
    verificationState: 'NOT_VERIFIED',
    provisionedResourceRefs: [],
    startedAt: request.requestedAt,
    verificationEvidenceRefs: request.evidenceRefs,
  });
});

test('fails closed when blueprint or rights grant is absent', async () => {
  const blueprints = new BlueprintProvider();
  blueprints.value = null;
  assert.equal(
    (await service({ blueprints }).activate(request)).status,
    'DENIED',
  );

  const rights = new RightsRepository();
  rights.value = null;
  const result = await service({ rights }).activate(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_RIGHTS_GRANT_NOT_FOUND');
});

test('rejects duplicate, mismatched, and inactive source rights', async () => {
  const duplicate = await service().activate({
    ...request,
    sourceRightsGrantIds: [activeGrant.grantId, activeGrant.grantId],
  });
  assert.equal(duplicate.status, 'DENIED');
  assert.equal(duplicate.code, 'ACTIVATION_RIGHTS_GRANTS_DUPLICATE');

  const rights = new RightsRepository();
  rights.value = { ...activeGrant, instanceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' };
  const mismatch = await service({ rights }).activate(request);
  assert.equal(mismatch.status, 'DENIED');
  assert.equal(mismatch.code, 'ACTIVATION_RIGHTS_GRANT_MISMATCH');

  rights.value = { ...activeGrant, state: 'SUSPENDED' };
  const inactive = await service({ rights }).activate(request);
  assert.equal(inactive.status, 'DENIED');
  assert.equal(inactive.code, 'ACTIVATION_RIGHTS_GRANT_INACTIVE');
});

test('rejects future or expired source rights at activation time', async () => {
  const rights = new RightsRepository();
  rights.value = { ...activeGrant, effectiveFrom: '2026-08-25T13:00:00.000Z' };
  let result = await service({ rights }).activate(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_RIGHTS_GRANT_NOT_EFFECTIVE');

  rights.value = { ...activeGrant, effectiveUntil: request.requestedAt };
  result = await service({ rights }).activate(request);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_RIGHTS_GRANT_NOT_EFFECTIVE');
});

test('does not persist an invalid activation request', async () => {
  const repository = new ActivationRepository();
  const result = await service({ repository }).activate({
    ...request,
    sourceRightsGrantIds: [],
  });
  assert.equal(result.status, 'DENIED');
  assert.equal(repository.recorded, null);
});

test('maps immutable retries and conflicts deterministically', async () => {
  const repository = new ActivationRepository();
  const activationService = service({ repository });

  repository.mode = 'ALREADY_RECORDED';
  assert.equal((await activationService.activate(request)).status, 'ALREADY_STARTED');

  repository.mode = 'CONFLICT';
  assert.equal((await activationService.activate(request)).status, 'CONFLICT');
});
