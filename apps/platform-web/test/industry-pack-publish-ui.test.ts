import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/PublishIndustryPackButton.tsx', import.meta.url),
  'utf8',
);

const page = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/page.tsx', import.meta.url),
  'utf8',
);

test('publish action calls only the governed review publish route', () => {
  assert.ok(action.includes('/api/configuration/industry-packs/reviews/${encodeURIComponent(verticalKey)}/${version}/publish'));
  assert.ok(action.includes("method: 'POST'"));
  assert.equal(action.includes('binding'), false);
  assert.equal(action.includes('SEPARATION_OF_DUTIES'), false);
});

test('version history exposes publish only beside tenant IN_REVIEW controls', () => {
  assert.ok(page.includes("version.scope === 'TENANT' && version.state === 'IN_REVIEW'"));
  assert.ok(page.includes('<PublishIndustryPackButton'));
  assert.ok(action.includes('router.refresh()'));
  assert.ok(action.includes('role="alert"'));
});
