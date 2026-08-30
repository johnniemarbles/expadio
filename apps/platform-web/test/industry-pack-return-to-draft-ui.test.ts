import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/ReturnIndustryPackToDraftButton.tsx', import.meta.url),
  'utf8',
);

const page = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/page.tsx', import.meta.url),
  'utf8',
);

test('return-to-draft action calls only the governed review return route', () => {
  assert.ok(action.includes('/api/configuration/industry-packs/reviews/${encodeURIComponent(verticalKey)}/${version}/return'));
  assert.ok(action.includes("method: 'POST'"));
  assert.equal(action.includes('/publish'), false);
  assert.equal(action.includes('/archive'), false);
});

test('version history exposes return only for tenant IN_REVIEW rows', () => {
  assert.ok(page.includes("version.scope === 'TENANT' && version.state === 'IN_REVIEW'"));
  assert.ok(page.includes('<ReturnIndustryPackToDraftButton'));
  assert.ok(action.includes('router.refresh()'));
});
