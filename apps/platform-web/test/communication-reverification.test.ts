import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { COMMUNICATION_REVERIFICATION, hasRecentCommunicationVerification } from '../lib/communication-reverification-policy.ts';

test('only server-confirmed verification for the same authenticated subject passes', () => {
  let calls = 0;
  const session = { userId: 'admin', has(request: unknown) {
    calls++;
    assert.deepEqual(request, { reverification: { level: 'multi_factor', afterMinutes: 5 } });
    return true;
  } };
  assert.equal(hasRecentCommunicationVerification(session, 'admin'), true);
  assert.equal(calls, 1);
  assert.equal(hasRecentCommunicationVerification(session, 'other-admin'), false);
  assert.equal(hasRecentCommunicationVerification(session, ''), false);
  assert.equal(hasRecentCommunicationVerification({ ...session, userId: null }, 'admin'), false);
  assert.equal(calls, 1, 'mismatched subjects cannot reach the freshness check');
  assert.equal(hasRecentCommunicationVerification({ ...session, has: () => false }, 'admin'), false);
});

test('verification failures cannot silently grant access', () => {
  assert.throws(() => hasRecentCommunicationVerification({ userId: 'admin', has: () => { throw new Error('verification unavailable'); } }, 'admin'));
  assert.equal(COMMUNICATION_REVERIFICATION.afterMinutes, 5);
});

test('all seven sensitive provider handlers challenge before bodies or side effects', () => {
  const paths = [
    ['communications/providers/route.ts', ['POST']],
    ['communications/providers/[key]/route.ts', ['PATCH', 'DELETE']],
    ['communications/providers/[key]/revoke/route.ts', ['POST']],
    ['communications/providers/[key]/test-send/route.ts', ['POST']],
    ['custody/wrapping-key/route.ts', ['GET']],
    ['custody/credentials/route.ts', ['POST']],
  ] as const;
  for (const [path, methods] of paths) {
    const source = readFileSync(new URL(`../app/api/${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /requireStepUp/);
    for (const method of methods) {
      const handler = source.split(`export async function ${method}(`)[1]?.split('export async function')[0];
      assert.ok(handler, `${path}: ${method}`);
      const authority = handler.indexOf('await requireCommunicationAdmin(context)');
      const challenge = handler.indexOf('await requireCommunicationReverification(context.subjectId)');
      const stop = handler.indexOf('if (challenge) return challenge');
      assert.ok(authority >= 0 && challenge > authority && stop > challenge, path);
      for (const operation of ['await request.json', 'await withTenantTransaction', 'wrappingKeys.issue()', 'service.intake(']) {
        const offset = handler.indexOf(operation);
        if (offset >= 0) assert.ok(offset > stop, `${path}: ${operation}`);
      }
    }
  }
});

test('provider controls handle challenges without sending timestamp assertions', () => {
  for (const file of ['ProviderModal', 'ConnectorActionsModal', 'CommunicationsDashboardClient']) {
    const source = readFileSync(new URL(`../app/(shell)/communications/${file}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /useCommunicationFetch\(\)/);
    assert.match(source, /await reverifiedFetch\(/);
    assert.doesNotMatch(source, /x-expadio-reauth-at/);
  }
  const server = readFileSync(new URL('../lib/communication-reverification.ts', import.meta.url), 'utf8');
  assert.match(server, /await auth\(\)/);
  assert.match(server, /reverificationErrorResponse\(COMMUNICATION_REVERIFICATION\)/);
  assert.doesNotMatch(server, /headers\(|Date\.parse/);
});
