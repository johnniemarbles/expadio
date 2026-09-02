import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/activity/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/(shell)/audit/page.tsx', import.meta.url), 'utf8');

test('activity route resolves the live authorized workspace instead of a demo fixture', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /organization_id = \$2/);
  assert.doesNotMatch(route, /00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(route, /00000000-0000-0000-0000-000000000002/);
});

test('activity route rejects a mismatched explicit organization selector', () => {
  assert.match(route, /requestedOrganizationId/);
  assert.match(route, /requestedOrganizationId !== context\.organizationId/);
  assert.match(route, /TENANT_ACCESS_DENIED/);
});

test('empty audit scope stays empty and never invents evidence', () => {
  assert.doesNotMatch(route, /activity_live_1|activity_live_2/);
  assert.doesNotMatch(route, /provisioned membership|indexed document|Policy handbook/);
  assert.match(page, /No governed events exist in the active workspace yet/);
  assert.doesNotMatch(page, /fixture scope/);
});

test('database and scope failures remain explicit denials', () => {
  assert.match(route, /deniedResponse\(error\)/);
  assert.match(route, /Activity evidence is incomplete/);
});
