import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const platform = readFileSync(new URL('../app/api/learning/me/assignment-attachments/route.ts', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-assignment.ts', import.meta.url), 'utf8');

test('attachment ingestion authorizes before buffering and keeps provider authority in Platform', () => {
  assert.ok(platform.indexOf('authorizeMyLearningAssignmentAttachment') < platform.indexOf('request.arrayBuffer()'));
  assert.match(platform, /purpose: 'LEARNING_SUBMISSION'/);
  assert.match(platform, /uploadContentAsset/);
  assert.match(platform, /quarantineContentAssetForScan/);
  assert.match(platform, /resolveQuarantinedContentAssetScan/);
  assert.match(platform, /service:content-asset-scanner/);
  assert.match(platform, /MAX_BYTES = 25 \* 1024 \* 1024/);
});

test('idempotent retries resume each persisted ingestion state', () => {
  assert.match(platform, /asset\.state === 'AVAILABLE'/);
  assert.match(platform, /state === 'PENDING_UPLOAD'/);
  assert.match(platform, /state === 'UPLOADED'/);
  assert.match(platform, /state !== 'QUARANTINED'/);
  assert.match(platform, /asset\.state === 'REJECTED' \|\| asset\.state === 'DELETED'/);
});

test('attachment authorization binds learner, enrollment, lesson, definition, due date and prerequisites', () => {
  assert.match(runtime, /authorizeMyLearningAssignmentAttachment/);
  assert.match(runtime, /learner\.subject_id=\$3/);
  assert.match(runtime, /learner\.subject_issuer IS NOT DISTINCT FROM \$4/);
  assert.match(runtime, /lesson\.course_version_id=enrollment\.course_version_id/);
  assert.match(runtime, /version\.allow_attachments=true/);
  assert.match(runtime, /version\.due_at IS NULL OR version\.due_at >= now\(\)/);
  assert.match(runtime, /prior\.required=true/);
});

test('submission accepts only available learner-owned submission assets within policy', () => {
  assert.match(runtime, /purpose = 'LEARNING_SUBMISSION' AND state = 'AVAILABLE'/);
  assert.match(runtime, /created_by_subject_id = \$3/);
  assert.match(runtime, /attachmentAssetIds\.length > row\.max_attachments/);
  assert.match(runtime, /learning_assignment_submission_assets/);
  assert.match(runtime, /payload: \{ assignmentVersionId:[\s\S]*attachmentAssetIds/);
});
