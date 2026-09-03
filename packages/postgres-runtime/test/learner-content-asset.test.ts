import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/content-assets.ts', import.meta.url), 'utf8');

test('learner asset grants bind identity, enrollment, immutable lesson and referenced asset', () => {
  assert.match(source, /issueMyLearningLessonAssetReadGrant/);
  assert.match(source, /learner\.subject_id = \$3/);
  assert.match(source, /learner\.subject_issuer IS NOT DISTINCT FROM \$4/);
  assert.match(source, /lesson\.course_version_id = enrollment\.course_version_id/);
  assert.match(source, /block->'data'->>'assetId' = \$6/);
  assert.match(source, /asset\.purpose = 'LEARNING_CONTENT'/);
  assert.match(source, /asset\.state = 'AVAILABLE'/);
  assert.match(source, /LEARNING_ASSET_ACCESS_DENIED/);
});

test('learner asset grants enforce prior required lessons and use short-lived store grant', () => {
  assert.match(source, /prior\.required = true/);
  assert.match(source, /progress\.status = 'COMPLETED'/);
  assert.match(source, /purpose: 'learning\.learner-playback'/);
  assert.match(source, /issueContentAssetReadGrant\(client, store/);
});
