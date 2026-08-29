import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/reviews/[verticalKey]/[version]/return/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack review return route moves only IN_REVIEW versions back to DRAFT', () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /current\.state !== 'IN_REVIEW'/);
  assert.match(route, /to: 'DRAFT'/);
  assert.match(route, /expectedState: 'IN_REVIEW'/);
  assert.match(route, /Only IN_REVIEW Industry Pack versions can be returned to draft/);
});

test('Industry Pack review return route remains tenant and actor scoped', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /scope = \{ type: 'TENANT' as const, tenantId: context\.tenantId \}/);
  assert.match(route, /actorSubjectId: context\.subjectId/);
  assert.doesNotMatch(route, /scope: \{ type: 'PLATFORM'/);
});

test('Industry Pack review return route converts lifecycle races into explicit conflicts', () => {
  assert.match(route, /INDUSTRY_PACK_LIFECYCLE_TRANSITION_CONFLICT/);
  assert.match(route, /status: 409/);
});
