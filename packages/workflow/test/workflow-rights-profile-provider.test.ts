import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowRightsProfileDefinition,
  WorkflowRightsProfileProvider,
} from '../src/index.ts';

const profile: WorkflowRightsProfileDefinition = {
  profileKey: 'territory-operator',
  version: 3,
  label: 'Territory operator',
  rightTypes: ['OPERATE'],
  permitsExclusivity: true,
  permitsDelegation: false,
  permitsSubAppointment: false,
};

test('rights profile provider resolves an exact tenant/key/version identity', async () => {
  const calls: unknown[] = [];
  const provider: WorkflowRightsProfileProvider = {
    async resolve(input) {
      calls.push(input);
      return input.profileKey === profile.profileKey && input.version === profile.version
        ? profile
        : null;
    },
  };

  const result = await provider.resolve({
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    profileKey: 'territory-operator',
    version: 3,
  });

  assert.deepEqual(result, profile);
  assert.deepEqual(calls[0], {
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    profileKey: 'territory-operator',
    version: 3,
  });
});
