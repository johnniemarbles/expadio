import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowRightsGrantRequest,
  WorkflowRightsProfileDefinition,
} from '../src/index.ts';

const profile: WorkflowRightsProfileDefinition = {
  profileKey: 'distribution-basic',
  version: 3,
  label: 'Distribution basic',
  rightTypes: ['SELL', 'MARKET'],
  maximumScope: {
    territoryIds: ['territory-ca'],
    channelKeys: ['retail'],
  },
  permitsExclusivity: false,
  permitsDelegation: false,
  permitsSubAppointment: false,
};

const request: WorkflowRightsGrantRequest = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'distribution-onboarding',
  grantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  beneficiaryOrganizationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  profile: { profileKey: profile.profileKey, version: profile.version },
  rightTypes: ['SELL'],
  scope: { territoryIds: ['territory-ca'], channelKeys: ['retail'] },
  effectiveFrom: '2026-08-25T09:00:00.000Z',
  sourceDecisionId: 'decision-1',
  sourceAgreementId: 'agreement-1',
  requestedBySubjectId: 'subject-approver',
  evidenceRefs: ['decision:decision-1', 'agreement:agreement-1'],
};

test('rights contract keeps profile version and business scope explicit', () => {
  assert.equal(profile.profileKey, 'distribution-basic');
  assert.equal(profile.version, 3);
  assert.deepEqual(profile.rightTypes, ['SELL', 'MARKET']);
  assert.deepEqual(request.scope.territoryIds, ['territory-ca']);
});

test('approval evidence is a source reference, not an implicit grant', () => {
  assert.equal(request.sourceDecisionId, 'decision-1');
  assert.equal(request.sourceAgreementId, 'agreement-1');
  assert.equal(request.requestedBySubjectId, 'subject-approver');
});
