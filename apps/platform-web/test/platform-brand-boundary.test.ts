import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Platform navigation contains control-plane surfaces only', () => {
  const route = read('../app/api/workspaces/route.ts');
  assert.match(route, /hasPlatformAdministrationRole/);
  assert.match(route, /PLATFORM_ACCESS_REQUIRED/);
  for (const href of ['/crm', '/gtm', '/dentex', '/vendors', '/expenses', '/configuration/credentials', '/agents/bindings', '/workflows/blueprints']) {
    assert.equal(route.includes("href: '" + href + "'"), false);
  }
  assert.match(route, /AI & Brain Governance/);
  assert.match(route, /Apps & Entitlements/);
});

test('provider infrastructure requires persisted Platform authority', () => {
  const collection = read('../app/api/communications/providers/route.ts');
  const detail = read('../app/api/communications/providers/[key]/route.ts');
  const revoke = read('../app/api/communications/providers/[key]/revoke/route.ts');
  for (const source of [collection, detail, revoke]) {
    assert.match(source, /hasPlatformAdministrationRole/);
    assert.match(source, /PLATFORM_ADMIN_REQUIRED/);
    assert.doesNotMatch(source, /context\.platformScope/);
  }
  assert.match(collection, /const ownershipScope: 'PLATFORM' = 'PLATFORM'/);
  assert.doesNotMatch(collection, /ownershipScope === 'TENANT'/);
});

test('legacy raw-secret credential intake is fail-closed', () => {
  const route = read('../app/api/configuration/credentials/route.ts');
  const page = read('../app/(shell)/configuration/credentials/page.tsx');
  assert.match(route, /LEGACY_CREDENTIAL_ROUTE_RETIRED/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /authToken|apiKey|createHash|credential_rotation_events/);
  assert.doesNotMatch(page, /RotateForm|authToken|apiKey/);
  assert.match(page, /governed wrapping/);
});

test('request context cannot derive Platform privilege from a request header', () => {
  const context = read('../lib/request-context.ts');
  assert.doesNotMatch(context, /x-expadio-scope/);
  assert.doesNotMatch(context, /platformScope/);
  assert.match(context, /context\.applyTo\(client, false\)/);
  assert.match(context, /RESET/);
});
