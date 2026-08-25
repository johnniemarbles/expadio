import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationBlueprintDefinition,
  WorkflowActivationBlueprintProvider,
  WorkflowActivationRecord,
  WorkflowActivationRepository,
  WorkflowActivationRequest,
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

class BlueprintProvider implements WorkflowActivationBlueprintProvider {
  value: WorkflowActivationBlueprintDefinition | null = blueprint;
  async resolve(): Promise<WorkflowActivationBlueprintDefinition | null> {
    return this.value;
  }
}

class Repository implements WorkflowActivationRepository {
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

test('pins blueprint and rights provenance without provisioning side effects', async () => {
  const repository = new Repository();
  const result = await new RepositoryWorkflowActivationService({
    blueprints: new BlueprintProvider(),
    repository,
  }).activate(request);

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

test('fails closed when the exact activation blueprint is absent', async () => {
  const blueprints = new BlueprintProvider();
  blueprints.value = null;
  const repository = new Repository();

  const result = await new RepositoryWorkflowActivationService({
    blueprints,
    repository,
  }).activate(request);

  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_BLUEPRINT_NOT_FOUND');
  assert.equal(repository.recorded, null);
});

test('does not persist an invalid activation request', async () => {
  const repository = new Repository();
  const result = await new RepositoryWorkflowActivationService({
    blueprints: new BlueprintProvider(),
    repository,
  }).activate({ ...request, sourceRightsGrantIds: [] });

  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'ACTIVATION_RIGHTS_GRANTS_REQUIRED');
  assert.equal(repository.recorded, null);
});

test('maps immutable retries and conflicts deterministically', async () => {
  const repository = new Repository();
  const service = new RepositoryWorkflowActivationService({
    blueprints: new BlueprintProvider(),
    repository,
  });

  repository.mode = 'ALREADY_RECORDED';
  assert.equal((await service.activate(request)).status, 'ALREADY_STARTED');

  repository.mode = 'CONFLICT';
  assert.equal((await service.activate(request)).status, 'CONFLICT');
});
