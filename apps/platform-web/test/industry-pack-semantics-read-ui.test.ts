import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/page.tsx', import.meta.url),
  'utf8',
);

test('draft detail exposes executable case-stage semantics without vertical branching', () => {
  assert.match(page, /Executable stage semantics/);
  assert.match(page, /requiredAttributeKeys/);
  assert.match(page, /requiredRelationships/);
  assert.match(page, /requiredDecisionOutcomes/);
  assert.match(page, /requirement\.message/);
  assert.match(page, /No executable case-stage semantics are declared/);
  assert.doesNotMatch(page, /DENTEX_CASE_STAGE_SEMANTICS|verticalKey === ['"]dentex['"]/);
});
