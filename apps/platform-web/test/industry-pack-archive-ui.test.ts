import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/ArchiveIndustryPackButton.tsx', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/page.tsx', import.meta.url),
  'utf8',
);

test('archive action calls only the governed version archive route', () => {
  assert.ok(action.includes('/api/configuration/industry-packs/versions/${encodeURIComponent(verticalKey)}/${version}/archive'));
  assert.ok(action.includes("method: 'POST'"));
  assert.equal(action.includes('binding'), false);
});

test('admin UI archives only safe non-published tenant states', () => {
  assert.ok(page.includes("version.state === 'DRAFT'"));
  assert.ok(page.includes("version.state === 'IN_REVIEW'"));
  assert.ok(page.includes("version.state === 'SUPERSEDED'"));
  assert.ok(page.includes('<ArchiveIndustryPackButton'));
  const publishedBranch = "version.state === 'PUBLISHED'";
  assert.equal(page.includes(publishedBranch), false);
});
