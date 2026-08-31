import assert from 'node:assert/strict';
import test from 'node:test';
import { businessStatus } from '../lib/tenant-contracts.ts';
import { modelCustomer } from '../lib/tenant-model-fixture.ts';
import { parsePage, parseTenantScope, readCustomer, readCustomers, readWork, tenantErrorResponse, TenantReadError, uuid, withTenantRead } from '../lib/tenant-read-model.ts';
import type { SqlClient } from '../lib/tenant-read-model.ts';

const identity = { tenantId: '10000000-0000-0000-0000-000000000001', organizationId: '20000000-0000-0000-0000-000000000001', subjectId: 'subject-one' };
const membership = { brand: 'Test brand', organization: 'Test organization', workspaceScope: 'ALL', locationScope: 'ALL' };
function client(respond: (sql: string, params?: unknown[]) => Record<string, unknown>[] = () => []) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let released = false;
  const db: SqlClient = {
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      calls.push({ sql, params }); return { rows: respond(sql, params) as T[] };
    },
    release() { released = true; },
  };
  return { db, calls, released: () => released, pool: { connect: async () => db } };
}
test('scope must be explicit, singular and valid; no demo default', () => {
  for (const query of ['', '?account=x&org=y', `?account=${identity.tenantId}&org=${identity.organizationId}&org=${identity.organizationId}`]) {
    assert.throws(() => parseTenantScope(new URL('https://app.invalid/' + query)), TenantReadError);
  }
  assert.deepEqual(parseTenantScope(new URL(`https://app.invalid/?account=${identity.tenantId}&org=${identity.organizationId}`)), { tenantId: identity.tenantId, organizationId: identity.organizationId });
});
test('unsupported location and workspace selectors never broaden scope', () => {
  for (const key of ['location', 'locationId', 'workspace', 'workspaceId']) assert.throws(() => parseTenantScope(new URL(`https://app.invalid/?account=${identity.tenantId}&org=${identity.organizationId}&${key}=one`)), (error: unknown) => error instanceof TenantReadError && error.status === 403);
});
test('identifier and pagination validation reject malformed or unbounded inputs', () => {
  assert.throws(() => uuid("' OR 1=1"), TenantReadError);
  for (const query of ['limit=0', 'limit=101', 'limit=-1', 'limit=NaN', 'offset=-1', 'offset=10001']) assert.throws(() => parsePage(new URL('https://app.invalid/?' + query)), TenantReadError);
  assert.deepEqual(parsePage(new URL('https://app.invalid/')), { limit: 50, offset: 0 });
});
test('transaction-local context precedes membership and business reads; commit releases', async () => {
  const c = client(sql => sql.includes('FROM platform.memberships') ? [membership] : []);
  const value = await withTenantRead(c.pool, identity, async (db, context) => { await db.query('SELECT business_read'); return context; });
  assert.equal(value.brand, 'Test brand');
  assert.match(c.calls[0].sql, /^BEGIN.*READ ONLY$/);
  assert.deepEqual(c.calls[1].params, [identity.tenantId, identity.organizationId, identity.subjectId]);
  assert.match(c.calls[2].sql, /m.organization_id = \$2 AND m.subject_id = \$3/);
  assert.match(c.calls[2].sql, /m.valid_until > CURRENT_TIMESTAMP/);
  assert.match(c.calls[2].sql, /m.issuer = 'https:\/\/clerk.expadio.com'/);
  assert.equal(c.calls[3].sql, 'SELECT business_read');
  assert.equal(c.calls.at(-1)?.sql, 'COMMIT'); assert.ok(c.released());
});
for (const [label, rows] of [
  ['missing membership', []], ['ambiguous membership', [membership, membership]],
  ['restricted locations', [{ ...membership, locationScope: 'SELECTED' }]],
  ['restricted workspaces', [{ ...membership, workspaceScope: 'SELECTED' }]],
] as const) test(label + ' denies before business reads', async () => {
  const c = client(sql => sql.includes('FROM platform.memberships') ? [...rows] : []);
  let ran = false;
  await assert.rejects(withTenantRead(c.pool, identity, async () => { ran = true; }), (error: unknown) => error instanceof TenantReadError && error.status === 403);
  assert.equal(ran, false); assert.equal(c.calls.at(-1)?.sql, 'ROLLBACK'); assert.ok(c.released());
});
test('query errors roll back and release without disclosing database details', async () => {
  const c = client(sql => sql.includes('FROM platform.memberships') ? [membership] : []);
  const internal = new Error('password=private schema=internal');
  await assert.rejects(withTenantRead(c.pool, identity, async () => { throw internal; }), internal);
  assert.ok(c.released()); assert.equal(c.calls.at(-1)?.sql, 'ROLLBACK');
  const response = tenantErrorResponse(internal);
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /password|schema/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('empty live customer list remains empty', async () => {
  const c = client();
  assert.deepEqual(await readCustomers(c.db, identity, { limit: 50, offset: 0 }), { items: [], hasMore: false });
  assert.deepEqual(c.calls[0].params, [identity.tenantId, identity.organizationId, 51, 0]);
  assert.match(c.calls[0].sql, /a.organization_id = \$2/);
});
test('pagination probes one extra row without claiming a total', async () => {
  const c = client(() => Array.from({ length: 3 }, () => modelCustomer.customer));
  const result = await readCustomers(c.db, identity, { limit: 2, offset: 0 });
  assert.equal(result.items.length, 2); assert.equal(result.hasMore, true);
});
test('missing and out-of-scope customers do not trigger child queries', async () => {
  const c = client();
  await assert.rejects(readCustomer(c.db, identity, identity.tenantId), (error: unknown) => error instanceof TenantReadError && error.status === 404);
  assert.equal(c.calls.length, 1);
});
test('detail reads canonical children and constrains every query to organization', async () => {
  const c = client(sql => sql.includes('SELECT c.contact_id') ? [modelCustomer.customer] : []);
  const result = await readCustomer(c.db, identity, identity.tenantId);
  assert.equal(result.customer.name, 'Jordan Lee');
  assert.deepEqual(result.tasks, []); assert.deepEqual(result.decisions, []);
  for (const call of c.calls) { assert.equal(call.params?.[0], identity.tenantId); assert.equal(call.params?.[1], identity.organizationId); assert.match(call.sql, /a.organization_id = \$2/); }
  assert.match(c.calls[2].sql, /workflow_stage_decisions/);
  assert.match(c.calls[3].sql, /operational_tasks/);
  assert.doesNotMatch(c.calls.map(call => call.sql).join('\n'), /tenant_work_items|tenant_follow_ups/);
});
test('work uses verified case aggregate and current assignee, not a current-user placeholder', async () => {
  const c = client(); await readWork(c.db, identity, { limit: 50, offset: 0 });
  assert.equal(c.calls[0].params?.[2], 'subject-one');
  assert.match(c.calls[0].sql, /aggregate_type = 'crm.case'/);
  assert.match(c.calls[0].sql, /k.account_id IS NULL OR k.account_id = c.account_id/);
});
test('delivery statuses remain distinct; unknown and uncertain are not failure', () => {
  const states = ['APPROVED', 'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'OUTCOME_UNCERTAIN'];
  assert.equal(new Set(states.map(businessStatus)).size, states.length);
  assert.equal(businessStatus('OUTCOME_UNCERTAIN'), 'Outcome uncertain');
  assert.equal(businessStatus('NEW_UNMAPPED_STATE'), 'Status not mapped');
});
test('model fixture has consistent customer/task linkage and no fabricated decisions', () => {
  assert.equal(modelCustomer.tasks[0].customerId, modelCustomer.customer.id);
  assert.equal(modelCustomer.tasks[0].status, 'OPEN');
  assert.deepEqual(modelCustomer.decisions, []);
});
