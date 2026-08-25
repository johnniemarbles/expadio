import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowActivationLifecycleRequest } from '../src/index.ts';
import { validateWorkflowActivationLifecycle } from '../src/index.ts';

const request: WorkflowActivationLifecycleRequest = {
  eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  expectedFromState: 'ACTIVE',
  action: 'SUSPEND',
  affectedRightsGrantIds: ['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'],
  monitoringTriggerKey: 'trade-control.status-changed',
  performedBySubjectId: 'compliance-officer-1',
  performedAt: '2026-08-25T14:00:00.000Z',
  reason: 'Standing gate failed.',
  evidenceRefs: ['monitoring-check:1'],
};

test('allows only deterministic active and suspended transitions', () => {
  assert.deepEqual(validateWorkflowActivationLifecycle(request), {
    valid: true,
    toState: 'SUSPENDED',
    issues: [],
  });
  assert.equal(validateWorkflowActivationLifecycle({
    ...request,
    expectedFromState: 'SUSPENDED',
    action: 'RESUME',
  }).valid, true);
  assert.equal(validateWorkflowActivationLifecycle({
    ...request,
    action: 'REVOKE',
  }).valid, true);
});

test('treats revocation as terminal', () => {
  for (const action of ['SUSPEND', 'RESUME', 'REVOKE'] as const) {
    const result = validateWorkflowActivationLifecycle({
      ...request,
      expectedFromState: 'REVOKED',
      action,
    });
    assert.equal(result.valid, false);
    assert.equal(result.issues[0]?.code, 'ACTIVATION_LIFECYCLE_TRANSITION_INVALID');
  }
});

test('rejects duplicate or absent affected rights', () => {
  let result = validateWorkflowActivationLifecycle({
    ...request,
    affectedRightsGrantIds: [],
  });
  assert.equal(result.issues[0]?.code, 'ACTIVATION_LIFECYCLE_RIGHTS_REQUIRED');

  result = validateWorkflowActivationLifecycle({
    ...request,
    affectedRightsGrantIds: [
      request.affectedRightsGrantIds[0]!,
      request.affectedRightsGrantIds[0]!,
    ],
  });
  assert.equal(result.issues[0]?.code, 'ACTIVATION_LIFECYCLE_RIGHTS_DUPLICATE');
});

test('rejects incomplete lifecycle audit metadata', () => {
  const result = validateWorkflowActivationLifecycle({
    ...request,
    eventId: '',
    monitoringTriggerKey: ' ',
    performedBySubjectId: '',
    performedAt: 'invalid',
    reason: '',
    evidenceRefs: [],
    sourceVerificationId: ' ',
  });
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    'ACTIVATION_LIFECYCLE_EVENT_ID_REQUIRED',
    'ACTIVATION_LIFECYCLE_TRIGGER_REQUIRED',
    'ACTIVATION_LIFECYCLE_ACTOR_REQUIRED',
    'ACTIVATION_LIFECYCLE_REASON_REQUIRED',
    'ACTIVATION_LIFECYCLE_OCCURRED_AT_INVALID',
    'ACTIVATION_LIFECYCLE_EVIDENCE_REQUIRED',
    'ACTIVATION_LIFECYCLE_VERIFICATION_ID_INVALID',
  ]);
});
