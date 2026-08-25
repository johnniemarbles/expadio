import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationLifecycleEvent,
  WorkflowActivationLifecycleRequest,
} from '../src/index.ts';

const request: WorkflowActivationLifecycleRequest = {
  eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  expectedFromState: 'ACTIVE',
  action: 'SUSPEND',
  affectedRightsGrantIds: ['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'],
  monitoringTriggerKey: 'trade-control.status-changed',
  sourceVerificationId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  performedBySubjectId: 'compliance-officer-1',
  performedAt: '2026-08-25T14:00:00.000Z',
  reason: 'Standing trade-control gate failed.',
  evidenceRefs: ['monitoring-check:1'],
};

test('lifecycle request targets activation and scoped rights, not case state', () => {
  assert.equal(request.action, 'SUSPEND');
  assert.equal(request.affectedRightsGrantIds.length, 1);
  assert.equal('workflowState' in request, false);
  assert.equal('caseState' in request, false);
});

test('lifecycle event preserves before/after state and audit evidence', () => {
  const event: WorkflowActivationLifecycleEvent = {
    ...request,
    fromState: request.expectedFromState,
    toState: 'SUSPENDED',
  };
  assert.equal(event.fromState, 'ACTIVE');
  assert.equal(event.toState, 'SUSPENDED');
  assert.equal(event.performedBySubjectId, 'compliance-officer-1');
  assert.deepEqual(event.evidenceRefs, ['monitoring-check:1']);
});

test('revocation is distinct from suspension and is terminal by contract', () => {
  const revoked: WorkflowActivationLifecycleEvent = {
    ...request,
    action: 'REVOKE',
    fromState: 'SUSPENDED',
    toState: 'REVOKED',
  };
  assert.equal(revoked.action, 'REVOKE');
  assert.notEqual(revoked.toState, 'SUSPENDED');
});
