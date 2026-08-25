import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RepositoryWorkflowRightsGrantService,
  type WorkflowRightsGrantRequest,
  type WorkflowRightsGrantRepository,
  type WorkflowRightsProfileDefinition,
  type WorkflowRightsProfileProvider,
} from '../src/index.ts';

const profile: WorkflowRightsProfileDefinition = {
  profileKey: 'territory-operator',
  version: 1,
  label: 'Territory operator',
  rightTypes: ['OPERATE'],
  maximumScope: { territoryIds: ['north'] },
  permitsExclusivity: true,
  permitsDelegation: false,
  permitsSubAppointment: false,
};

const request: WorkflowRightsGrantRequest = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  grantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  beneficiaryOrganizationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  profile: { profileKey: profile.profileKey, version: profile.version },
  rightTypes: ['OPERATE'],
  scope: { territoryIds: ['north'] },
  exclusivityKey: 'north',
  effectiveFrom: '2026-08-25T10:00:00.000Z',
  requestedBySubjectId: 'subject-1',
  evidenceRefs: ['decision:1'],
};

function service(input?: {
  readonly profile?: WorkflowRightsProfileDefinition | null;
  readonly recordStatus?: 'COMMITTED' | 'ALREADY_RECORDED' | 'CONFLICT';
}) {
  const writes: unknown[] = [];
  const profileLookups: unknown[] = [];
  const profiles: WorkflowRightsProfileProvider = {
    async resolve(lookup) {
      profileLookups.push(lookup);
      return input?.profile === undefined ? profile : input.profile;
    },
  };
  const repository: WorkflowRightsGrantRepository = {
    async find() { return null; },
    async record(grant) {
      writes.push(grant);
      if (input?.recordStatus === 'ALREADY_RECORDED') {
        return { status: 'ALREADY_RECORDED', grant };
      }
      if (input?.recordStatus === 'CONFLICT') {
        return { status: 'CONFLICT', existing: { ...grant, rightTypes: ['OTHER'] } };
      }
      return { status: 'COMMITTED', grant };
    },
  };
  return {
    writes,
    profileLookups,
    service: new RepositoryWorkflowRightsGrantService({
      profiles,
      repository,
      now: () => '2026-08-25T10:05:00.000Z',
    }),
  };
}

test('resolves the exact tenant/profile/version requested before validating the grant', async () => {
  const fixture = service();
  await fixture.service.grant(request);
  assert.deepEqual(fixture.profileLookups, [{
    tenantId: request.tenantId,
    profileKey: request.profile.profileKey,
    version: request.profile.version,
  }]);
});

test('denies when exact rights profile cannot be resolved without writing a grant', async () => {
  const fixture = service({ profile: null });
  const result = await fixture.service.grant(request);
  assert.equal(result.status, 'DENIED');
  if (result.status === 'DENIED') assert.equal(result.code, 'RIGHTS_PROFILE_NOT_FOUND');
  assert.equal(fixture.writes.length, 0);
});

test('denies invalid scope before repository write', async () => {
  const fixture = service();
  const result = await fixture.service.grant({
    ...request,
    scope: { territoryIds: ['south'] },
  });
  assert.equal(result.status, 'DENIED');
  if (result.status === 'DENIED') assert.equal(result.code, 'RIGHTS_SCOPE_EXCEEDS_PROFILE');
  assert.equal(fixture.writes.length, 0);
});

test('builds and commits one immutable ACTIVE rights grant', async () => {
  const fixture = service();
  const result = await fixture.service.grant(request);
  assert.equal(result.status, 'GRANTED');
  assert.equal(fixture.writes.length, 1);
  const written = fixture.writes[0] as { state: string; grantedAt: string; grantedBySubjectId: string };
  assert.equal(written.state, 'ACTIVE');
  assert.equal(written.grantedAt, '2026-08-25T10:05:00.000Z');
  assert.equal(written.grantedBySubjectId, request.requestedBySubjectId);
});

test('maps repository replay and conflict without provisioning side effects', async () => {
  const replay = service({ recordStatus: 'ALREADY_RECORDED' });
  assert.equal((await replay.service.grant(request)).status, 'ALREADY_GRANTED');

  const conflict = service({ recordStatus: 'CONFLICT' });
  assert.equal((await conflict.service.grant(request)).status, 'CONFLICT');
});
