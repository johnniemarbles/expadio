import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { after, test } from 'node:test';

const key = Symbol.for('expadio.live-membership.test');
const calls: string[] = [];
(globalThis as any)[key] = calls;
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  let source: string | undefined;
  if (specifier === '@clerk/nextjs/server') source = 'export async function clerkClient() { throw Error("unexpected identity call"); }';
  if (specifier === 'pg') source = `export default { Pool: class {
    async query(sql) { globalThis[Symbol.for('expadio.live-membership.test')].push(sql); return { rows: [], rowCount: 0 }; }
    async connect() { return { query: this.query.bind(this), release() {} }; }
  } };`;
  if (specifier === '@expadio/postgres-runtime') source = `export class PostgresMembershipRepository {
    constructor(client) { this.client = client; }
    async listActiveMemberships() { return (await this.client.query('SELECT persisted_memberships')).rows; }
  }`;
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.endsWith("/lib/iam-adapter.ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
  return nextLoad(url, context);
} });
const { membershipRepository } = await import(new URL('../lib/iam-adapter.ts', import.meta.url).href);
const { shouldGrantPlatformAdmin } = await import(new URL('../lib/admin-grant.ts', import.meta.url).href);
after(() => { hook.deregister(); delete (globalThis as any)[key]; });

test('the live membership export never provisions an unknown authenticated subject', async () => {
  const result = await membershipRepository.listActiveMemberships({ subjectId: 'new-user', actorKind: 'user', issuer: 'test' });
  assert.deepEqual(result, []);
  assert.deepEqual(calls, ['SELECT persisted_memberships']);
});

test('admin grants are closed by default and demo opt-in cannot grant in production', () => {
  const env = process.env as Record<string, string | undefined>;
  const original = { subjects: process.env.PLATFORM_ADMIN_SUBJECTS, demo: process.env.DEMO_OPEN_ADMIN, mode: process.env.NODE_ENV };
  try {
    delete process.env.PLATFORM_ADMIN_SUBJECTS; delete process.env.DEMO_OPEN_ADMIN;
    env.NODE_ENV = 'development'; assert.equal(shouldGrantPlatformAdmin('new-user'), false);
    process.env.DEMO_OPEN_ADMIN = 'true'; assert.equal(shouldGrantPlatformAdmin('new-user'), true);
    env.NODE_ENV = 'production'; assert.equal(shouldGrantPlatformAdmin('new-user'), false);
    process.env.PLATFORM_ADMIN_SUBJECTS = 'approved-user'; assert.equal(shouldGrantPlatformAdmin('approved-user'), true);
  } finally {
    for (const [name, value] of [['PLATFORM_ADMIN_SUBJECTS', original.subjects], ['DEMO_OPEN_ADMIN', original.demo], ['NODE_ENV', original.mode]] as const) {
      if (value === undefined) delete process.env[name]; else env[name] = value;
    }
  }
});
