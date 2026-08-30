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
  assert.ok(
    action.includes(
      '/api/configuration/industry-packs/drafts/${encodeURIComponent(verticalKey)}/${version}/submit',
    ),
  );
  assert.ok(action.includes("method: 'POST'"));
  assert.equal(action.includes('publish'), false);
  assert.equal(action.includes('archive'), false);
  assert.equal(action.includes('/return'), false);
});

test('draft submit action navigates back to version history after success', () => {
  assert.ok(action.includes('router.push'));
  assert.ok(
    action.includes('/configuration/industry-packs?vertical=${encodeURIComponent(verticalKey)}'),
  );
  assert.ok(action.includes('router.refresh()'));
  assert.ok(action.includes('role="alert"'));
});
