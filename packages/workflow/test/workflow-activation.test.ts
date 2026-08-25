import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationBlueprintDefinition,
  WorkflowActivationRequest,
} from '../src/workflow-activation.ts';

const blueprint: WorkflowActivationBlueprintDefinition = {
  blueprintKey: 'partner-activation',
  version: 1,
  label: 'Partner activation',
  workTypeKey: 'partner-onboarding',
  provisioningModel: 'SCOPED_WORKSPACE',
  steps: [
    {
      stepKey: 'create-workspace',
      label: 'Create scoped workspace',
      sequence: 0,
      requiredBeforeActive: true,
      actionKey: 'workspace.create-scoped',
    },
    {
      stepKey: 'verify-access',
      label: 'Verify access',
      sequence: 1,
      requiredBeforeActive: true,
      actionKey: 'workspace.verify-access',
    },
  ],
};

const request: WorkflowActivationRequest = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  activationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version },
  sourceRightsGrantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
  requestedBySubjectId: 'subject-1',
  requestedAt: '2026-08-25T09:40:00.000Z',
  evidenceRefs: ['rights-grant:dddddddd-dddd-dddd-dddd-dddddddddddd'],
};

test('activation contract keeps provisioning explicit after rights grant', () => {
  assert.equal(blueprint.provisioningModel, 'SCOPED_WORKSPACE');
  assert.deepEqual(
    blueprint.steps.filter((step) => step.requiredBeforeActive).map((step) => step.stepKey),
    ['create-workspace', 'verify-access'],
  );
  assert.equal(request.sourceRightsGrantIds.length, 1);
  assert.equal(request.blueprint.version, 1);
});
