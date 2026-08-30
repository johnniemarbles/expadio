import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(
  new URL(
    '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/DraftSubmitReviewAction.tsx',
    import.meta.url,
  ),
  'utf8',
);

test('draft submit action calls only the governed submit route', () => {
  assert.match(action, /industry-packs\\/drafts\\/.*\\/submit/);
  assert.match(action, /method: 'POST'/);
  assert.doesNotMatch(action, /publish|archive|return/);
});

test('draft submit action navigates back to version history after success', () => {
  assert.match(action, /router\\.push/);
  assert.match(action, /configuration\\/industry-packs\\?vertical=/);
  assert.match(action, /router\\.refresh\\(\\)/);
  assert.match(action, /role=\"alert\"/);
});
