import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateWorkflowRightsGrant,
  type WorkflowRightsGrantRequest,
  type WorkflowRightsProfileDefinition,
} from '../src/index.ts';

const profile: WorkflowRightsProfileDefinition = {
  profileKey: 'distribution-basic',
  version: 1,
  label: 'Distribution basic',
  rightTypes: ['SELL', 'MARKET'],
  maximumScope: {
    territoryIds: ['north', 'south'],
    channelKeys: ['retail', 'online'],
  },
  permitsExclusivity: false,
  permitsDelegation: false,
  permitsSubAppointment: false,
};

function request(overrides: Partial<WorkflowRightsGrantRequest> = {}): WorkflowRightsGrantRequest {
  return {
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    workTypeKey: 'distribution-onboarding',
    grantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    beneficiaryOrganizationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    profile: { profileKey: profile.profileKey, version: profile.version },
    rightTypes: ['SELL'],
    scope: { territoryIds: ['north'], channelKeys: ['retail'] },
    effectiveFrom: '2026-08-25T09:00:00.000Z',
    requestedBySubjectId: 'subject-1',
    evidenceRefs: [],
    ...overrides,
  };
}

test('accepts a request within the exact profile/version and scope', () => {
  const result = validateWorkflowRightsGrant(profile, request());
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test('rejects unpermitted right types, exclusivity, and scope broadening', () => {
  const result = validateWorkflowRightsGrant(profile, request({
    rightTypes: ['SELL', 'ADMIN'],
    exclusivityKey: 'exclusive',
    scope: { territoryIds: ['west'], channelKeys: ['retail'] },
  }));

  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.issues.map((entry) => entry.code)),
    new Set([
      'RIGHTS_TYPE_NOT_PERMITTED',
      'RIGHTS_EXCLUSIVITY_NOT_PERMITTED',
      'RIGHTS_SCOPE_EXCEEDS_PROFILE',
    ]),
  );
});

test('requires exactly one beneficiary and exact profile identity', () => {
  const result = validateWorkflowRightsGrant(profile, request({
    beneficiarySubjectId: 'subject-2',
    profile: { profileKey: 'other', version: 2 },
  }));

  assert.equal(result.valid, false);
  assert.equal(result.issues.some((entry) => entry.code === 'RIGHTS_BENEFICIARY_INVALID'), true);
  assert.equal(result.issues.some((entry) => entry.code === 'RIGHTS_PROFILE_MISMATCH'), true);
});

test('rejects an invalid effective range', () => {
  const result = validateWorkflowRightsGrant(profile, request({
    effectiveUntil: '2026-08-25T08:00:00.000Z',
  }));

  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, 'RIGHTS_EFFECTIVE_RANGE_INVALID');
});
