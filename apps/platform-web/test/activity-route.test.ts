import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, beforeEach, mock, test } from 'node:test';

// Execute the real handler with controlled identity/database boundaries. These
// tests prove event mapping, not live IAM, SQL/RLS, or provider integration.
const key = Symbol.for('expadio.activity-route.test');
const state = {
  userId: 'audit-reader' as string | null,
  agentRows: [] as Record<string, unknown>[],
  readRows: [] as Record<string, unknown>[],
  queries: 0,
  failQuery: false,
};
(globalThis as any)[key] = state;
const accessState = "globalThis[Symbol.for('expadio.activity-route.test')]";
const modules: Record<string, string> = {
  '@expadio/authorization': `export function authorize() { return { allowed: true }; }`,
  '@expadio/postgres-runtime/authorization': `export class PostgresAuthorizationPolicyRepository { async loadPolicy() { return {}; } }`,
  '../../../lib/request-context': `
    export class ContextDenied extends Error { constructor(key, message, status) { super(message); this.status = status; } }
    export async function resolveRequestContext() {
      if (!${accessState}.userId) throw new ContextDenied('UNAUTHENTICATED', 'Sign in.', 401);
      return { tenantId: 'test-tenant', organizationId: 'test-org', effectiveContext: { tenantId: 'test-tenant', organizationId: 'test-org' } };
    }
    export function deniedResponse(error) { return { status: error.status || 500, body: { denied: true } }; }
    export async function withTenantTransaction(context, work) { return work({ async query(sql) {
      const state = ${accessState};
      state.queries++;
      if (state.failQuery) throw new Error('Database unavailable');
      return { rows: sql.includes('platform.agent_run_events') ? state.agentRows : state.readRows };
    } }); }
  `,
};
const routeUrl = new URL('../app/api/activity/route.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === routeUrl && specifier in modules) {
      return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
    }
    if (context.parentURL === routeUrl && specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    return nextResolve(specifier, context);
  },
});
const { GET } = await import(routeUrl);
after(() => { hooks.deregister(); delete (globalThis as any)[key]; });
beforeEach(() => {
  mock.method(console, 'error', () => {});
  state.userId = 'audit-reader';
  state.agentRows = [];
  state.readRows = [];
  state.queries = 0;
  state.failQuery = false;
});

const request = () => new Request('https://example.test/api/activity');
const agent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1', actor: 'recorded-subject', action: 'PROPOSAL_CREATED',
  target: 'proposal:1', time: new Date('2026-08-30T10:00:00.000Z'), ...overrides,
});

for (const field of ['id', 'actor', 'action', 'target']) {
  test(`missing ${field} is not replaced by placeholder evidence`, async () => {
    state.agentRows = [agent({ [field]: null })];
    const response = await GET(request());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).denied, true);
  });
}

test('empty persisted tables produce an empty live timeline', async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.equal(state.queries, 2);
});

test('only persisted agent/read events are returned, ordered by their recorded times', async () => {
  state.agentRows = [agent()];
  state.readRows = [{ id: 'read-1', actor: 'reader-2', outcome: 'DENIED', resource_type: 'document',
    resource_id: 'document-7', time: '2026-08-30T11:00:00.000Z' }];
  const response = await GET(request());
  assert.equal(response.status, 200);
  const items = await response.json();
  assert.deepEqual(items.map(({ timeLabel, ...item }: any) => item), [
    { id: 'read-1', actor: 'reader-2', action: 'read access denied', target: 'document document-7', time: '2026-08-30T11:00:00.000Z' },
    { id: 'event-1', actor: 'recorded-subject', action: 'proposal created', target: 'proposal:1', time: '2026-08-30T10:00:00.000Z' },
  ]);
});

for (const time of [null, undefined, '', 'not-a-date', new Date(NaN)]) {
  test(`missing/invalid event time (${String(time)}) is not replaced with now`, async () => {
    state.agentRows = [agent({ time })];
    const response = await GET(request());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).denied, true);
  });
}

test('a missing sensitive-read timestamp is not synthesized', async () => {
  state.readRows = [{ id: 'read-1', actor: 'reader', outcome: 'ALLOWED', resource_type: 'document', resource_id: '1', time: null }];
  const response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).denied, true);
});

test('unauthenticated requests return no activity and do not query the database', async () => {
  state.userId = null;
  const response = await GET(request());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).denied, true);
  assert.equal(state.queries, 0);
});

test('database failures are not disguised as empty or sample activity', async () => {
  state.failQuery = true;
  const response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).denied, true);
});
