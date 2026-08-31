import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, beforeEach, test } from 'node:test';

// Real request resolver, IAM membership resolution, policy repository,
// authorization evaluator and GET handler; controlled identity/SQL transport.
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const org = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const key = Symbol.for('expadio.audit-scope.test');
const state = {
  user: 'reader' as string | null, headers: new Headers(), memberships: [] as any[],
  grants: [] as any[], restrictions: [] as any[], membershipReads: 0, protectedReads: 0,
  queries: [] as string[], settings: new Map<string, string>(), transaction: false, releases: 0,
};
(globalThis as any)[key] = state;
const globalState = "globalThis[Symbol.for('expadio.audit-scope.test')]";
const root = new URL('../../../', import.meta.url);
const sources: Record<string, string> = {
  '@expadio/iam': new URL('packages/iam/src/index.ts', root).href,
  '@expadio/tenancy': new URL('packages/tenancy/src/index.ts', root).href,
  '@expadio/tenancy-persistence': new URL('packages/tenancy-persistence/src/index.ts', root).href,
  '@expadio/authorization': new URL('packages/authorization/src/index.ts', root).href,
};
const fakeIam = `
 const s = ${globalState};
 export const identityVerifier = { async verify({ credential }) { return { providerKey: 'test', subjectId: credential, issuer: 'test', actorKind: 'user' }; } };
 export const membershipRepository = { async listActiveMemberships() { s.membershipReads++; return s.memberships; } };
 const client = { async query(sql, values = []) {
   s.queries.push(sql);
   if (sql === 'BEGIN') { if (s.transaction) throw Error('nested transaction'); s.transaction = true; return { rows: [] }; }
   if (sql === 'COMMIT' || sql === 'ROLLBACK') { s.transaction = false; s.settings.clear(); return { rows: [] }; }
   if (sql.includes('set_config')) { if (!s.transaction) throw Error('unbound transaction'); s.settings.set(values[0], values[1]); return { rows: [] }; }
   if (!s.transaction) throw Error('unbound read');
   if (sql.includes('authorization_assignments')) return { rows: s.grants };
   if (sql.includes('authorization_restrictions')) return { rows: s.restrictions };
   if (sql.includes('platform.agent_run_events') || sql.includes('platform.sensitive_read_events')) {
     s.protectedReads++;
     if (values[0] !== s.settings.get('app.tenant_id') || values[1] !== s.settings.get('app.organization_id')) throw Error('scope lost');
     return { rows: sql.includes('agent_run_events') ? [{ id: 'event-1', actor: 'recorded-actor', action: 'STARTED', target: 'run:1', time: new Date('2026-08-30T10:00:00Z') }] : [] };
   }
   throw Error('unexpected SQL');
 }, release() { s.releases++; } };
 export const dbPool = { async connect() { return client; } };
`;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (sources[specifier]) return { url: sources[specifier], shortCircuit: true };
  let source: string | undefined;
  if (specifier === '@clerk/nextjs/server') source = `export async function auth() { return { userId: ${globalState}.user }; }`;
  if (specifier === 'next/headers') source = `export async function headers() { return ${globalState}.headers; }`;
  if (specifier.endsWith('/iam-adapter')) source = fakeIam;
  if (specifier === '@expadio/postgres-runtime/authorization') source = `export { PostgresAuthorizationPolicyRepository } from '${new URL('packages/postgres-runtime/src/authorization.ts', root).href}';`;
  if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  if (specifier.endsWith('/request-context')) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
} });
const { GET } = await import(new URL('../app/api/activity/route.ts', import.meta.url).href);
const { resolveRequestContext, requestedOrganizationId, withTenantTransaction } = await import(new URL('../lib/request-context.ts', import.meta.url).href);
after(() => { hooks.deregister(); delete (globalThis as any)[key]; });
beforeEach(() => {
  state.user = 'reader'; state.headers = new Headers({ 'x-expadio-tenant-id': tenant, 'x-expadio-organization-id': org });
  state.memberships = [{ tenantId: tenant, organizationId: org }];
  state.grants = [{ assignment_id: 'grant', organization_id: org, role_key: 'AUDITOR', action_organization_ids: [org],
    action_operating_unit_ids: null, action_resource_ids: null, visibility_organization_ids: null,
    visibility_operating_unit_ids: null, visibility_resource_ids: null, clearances: ['restricted'], sensitive_compartments: [],
    action: 'audit.activity.read', resource_type: 'audit-activity', blocked_states: [] }];
  state.restrictions = []; state.membershipReads = 0; state.protectedReads = 0; state.queries = [];
  state.settings.clear(); state.transaction = false; state.releases = 0;
});
const request = (query = '') => new Request('https://example.test/api/activity' + query);
async function denied(query = '', status = 403) {
  const response = await GET(request(query));
  assert.equal(response.status, status); assert.equal((await response.json()).denied, true);
  assert.equal(state.protectedReads, 0); assert.equal(state.transaction, false); assert.equal(state.settings.size, 0);
}

test('authorized live request queries its real scope inside a transaction', async () => {
  const response = await GET(request()); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((item: any) => item.id), ['event-1']);
  assert.equal(state.protectedReads, 2); assert.equal(state.releases, 1); assert.equal(state.settings.size, 0);
});
test('no session fails before membership or protected reads', async () => {
  state.user = null; await denied('', 401); assert.equal(state.membershipReads, 0); assert.deepEqual(state.queries, []);
});
for (const header of ['x-expadio-tenant-id', 'x-expadio-organization-id']) {
  test(`missing ${header} never bootstraps demo scope`, async () => { state.headers.delete(header); await denied(); assert.equal(state.membershipReads, 0); });
}
for (const query of ['?account=', '?org=bad', `?org=${org}&organizationId=${other}`, `?org=${org}&org=${other}`]) {
  test(`invalid/conflicting explicit scope denies: ${query}`, async () => { await denied(query); assert.equal(state.membershipReads, 0); });
}
test('another tenant denies before opening a database client', async () => { await denied(`?account=${other}`); assert.deepEqual(state.queries, []); });
test('another organization within the same tenant denies before protected reads', async () => { await denied(`?organizationId=${other}`); assert.deepEqual(state.queries, []); });
test('membership without an audit capability is insufficient', async () => { state.grants = []; await denied(); });
test('resource-limited grant cannot read the organization audit collection', async () => { state.grants[0].visibility_resource_ids = ['another-resource']; await denied(); });
test('restricted audit data requires clearance', async () => { state.grants[0].clearances = []; await denied(); });
test('persisted denial overrides the audit grant', async () => {
  state.restrictions = [{ restriction_key: 'BLOCKED', action: 'audit.activity.read', resource_type: 'audit-activity', resource_id: org, reason: 'blocked' }]; await denied();
});
test('a platform header cannot grant platform authority', async () => { state.headers.set('x-expadio-scope', 'PLATFORM'); await denied(); });
test('organization helper respects selection and returns no demo identity when missing', async () => {
  assert.equal(await requestedOrganizationId({ org: other }), other);
  state.headers.delete('x-expadio-organization-id'); assert.equal(await requestedOrganizationId({}), '');
});
test('rollback and pooled reuse do not retain the previous scope', async () => {
  const first = await resolveRequestContext(request());
  await assert.rejects(withTenantTransaction(first, async () => { throw Error('failure'); }), /failure/);
  assert.equal(state.settings.size, 0);
  state.headers.set('x-expadio-organization-id', other); state.memberships = [{ tenantId: tenant, organizationId: other }];
  const second = await resolveRequestContext(request());
  await withTenantTransaction(second, async () => { assert.equal(state.settings.get('app.organization_id'), other); });
  assert.equal(state.settings.size, 0); assert.equal(state.releases, 2);
});
