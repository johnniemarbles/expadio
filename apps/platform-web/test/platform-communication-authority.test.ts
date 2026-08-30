import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasPlatformCommunicationAuthority } from '../lib/platform-communication-authority.ts';
import { shouldGrantPlatformAdmin } from '../lib/admin-grant.ts';

test('authority lookup binds verified subject, tenant and organization and fails closed', async () => {
  const context = { subjectId: 'verified-user', tenantId: 'tenant-a', organizationId: 'org-a' };
  let query = '';
  const client = { async query(sql: string, values: unknown[]) {
    query = sql;
    assert.deepEqual(values, ['verified-user', 'tenant-a', 'org-a']);
    return { rows: [] };
  } };
  assert.equal(await hasPlatformCommunicationAuthority(client, context), false);
  for (const invariant of ["a.tenant_id = $2::uuid", "r.ownership_scope = 'PLATFORM'", 'r.tenant_id IS NULL',
    "a.status = 'ACTIVE'", "r.status = 'ACTIVE'", 'a.valid_from <= now()', 'a.valid_until > now()',
    'a.organization_id = $3::uuid', 'a.action_organization_ids IS NULL', 'a.action_operating_unit_ids IS NULL',
    'a.action_resource_ids IS NULL', 'platform.authorization_restrictions']) {
    assert.ok(query.includes(invariant), invariant);
  }
  assert.equal(await hasPlatformCommunicationAuthority({ async query() { return { rows: [{}] }; } }, context), true);
  await assert.rejects(hasPlatformCommunicationAuthority({ async query() { throw new Error('database unavailable'); } }, context));
});

test('automatic admin grants default off and demo opt-in cannot grant in production', () => {
  assert.equal(shouldGrantPlatformAdmin('brand-user', {}), false);
  assert.equal(shouldGrantPlatformAdmin('brand-user', { NODE_ENV: 'development' }), false);
  assert.equal(shouldGrantPlatformAdmin('brand-user', { NODE_ENV: 'development', DEMO_OPEN_ADMIN: 'true' }), true);
  const production = { NODE_ENV: 'production', DEMO_OPEN_ADMIN: 'true' };
  assert.equal(shouldGrantPlatformAdmin('brand-user', production), false);
  const allowlisted = { ...production, PLATFORM_ADMIN_SUBJECTS: ' platform-admin ' };
  assert.equal(shouldGrantPlatformAdmin('platform-admin', allowlisted), true);
  assert.equal(shouldGrantPlatformAdmin('brand-user', allowlisted), false);
});

test('every provider and custody HTTP handler gates administration before work', () => {
  const handlers = [
    ['communications/providers/route.ts', 2],
    ['communications/providers/[key]/route.ts', 2],
    ...['health', 'blast-radius', 'attestation', 'revoke', 'test-send'].map(name => [`communications/providers/[key]/${name}/route.ts`, 1]),
    ['custody/credentials/route.ts', 1], ['custody/wrapping-key/route.ts', 1],
  ] as const;
  for (const [path, count] of handlers) {
    const source = readFileSync(new URL(`../app/api/${path}`, import.meta.url), 'utf8');
    assert.equal(source.match(/await requireCommunicationAdmin\(context\)/g)?.length, count, String(path));
    for (const handler of source.split(/export async function /).slice(1)) {
      const gate = handler.indexOf('await requireCommunicationAdmin(context)');
      assert.ok(gate >= 0, String(path));
      for (const operation of ['await request.json', 'await withTenantTransaction', 'wrappingKeys.issue()', 'service.intake(']) {
        const index = handler.indexOf(operation);
        if (index >= 0) assert.ok(gate < index, `${path}: ${operation}`);
      }
    }
  }
});

test('brand view does not fetch provider metadata and registration uses one platform-owned identity', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const context = read('../lib/request-context.ts');
  assert.doesNotMatch(context, /headerList.get\('x-expadio-scope'\)/);
  assert.match(context, /hasPlatformCommunicationAuthority\(client, context\)/);
  const page = read('../app/(shell)/communications/page.tsx');
  assert.ok(page.indexOf('return <BrandCommunications') < page.indexOf('fetchApi<ConnectorListItem'));
  const brand = read('../app/(shell)/communications/BrandCommunications.tsx');
  assert.doesNotMatch(brand, /ProviderModal|ConnectorActionsModal|credentialRef|fingerprint|\/api\/custody/);
  const route = read('../app/api/communications/providers/route.ts');
  assert.match(route, /const ownershipScope = 'PLATFORM'/);
  assert.match(route, /body.ownershipScope !== 'PLATFORM'/);
  const modal = read('../app/(shell)/communications/ProviderModal.tsx');
  assert.match(modal, /ownershipScope: 'PLATFORM'/);
  assert.match(modal, /registerConnector\(reference, capabilities, registeredKey\)/);
});
