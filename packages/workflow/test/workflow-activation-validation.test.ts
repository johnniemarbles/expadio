import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type WorkflowActivationBlueprintDefinition,
  type WorkflowActivationRequest,
  validateWorkflowActivation,
} from '../src/index.ts';

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
  workTypeKey: blueprint.workTypeKey,
  activationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version },
  sourceRightsGrantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
  requestedBySubjectId: 'subject-1',
  requestedAt: '2026-08-25T12:30:00.000Z',
  evidenceRefs: ['rights-grant:dddddddd-dddd-dddd-dddd-dddddddddddd'],
};

test('accepts an exact activation request without side effects', () => {
  assert.deepEqual(validateWorkflowActivation(blueprint, request), {
    valid: true,
    issues: [],
  });
});

test('rejects blueprint, work-type and source-rights mismatches', () => {
  const result = validateWorkflowActivation(blueprint, {
    ...request,
    workTypeKey: 'other',
    blueprint: { blueprintKey: 'other', version: 2 },
    sourceRightsGrantIds: [],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    'ACTIVATION_BLUEPRINT_MISMATCH',
    'ACTIVATION_WORK_TYPE_MISMATCH',
    'ACTIVATION_RIGHTS_GRANTS_REQUIRED',
  ]);
});

test('rejects an invalid request timestamp', () => {
  const result = validateWorkflowActivation(blueprint, {
    ...request,
    requestedAt: 'not-an-instant',
  });
  assert.equal(result.issues[0]?.code, 'ACTIVATION_REQUESTED_AT_INVALID');
});

test('rejects ambiguous or non-executable activation steps', () => {
  const result = validateWorkflowActivation({
    ...blueprint,
    steps: [
      blueprint.steps[0]!,
      { ...blueprint.steps[1]!, stepKey: 'create-workspace', sequence: 0, actionKey: ' ' },
    ],
  }, request);
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    'ACTIVATION_STEP_KEY_DUPLICATE',
    'ACTIVATION_STEP_SEQUENCE_INVALID',
    'ACTIVATION_STEP_ACTION_REQUIRED',
  ]);
});
