import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const form = readFileSync(new URL('../components/LearnerAssignmentForm.tsx', import.meta.url), 'utf8');
const proxy = readFileSync(new URL('../app/api/learning/assignments/attachments/route.ts', import.meta.url), 'utf8');
const grader = readFileSync(new URL('../components/AssignmentGradingQueue.tsx', import.meta.url), 'utf8');

test('Brand hashes and uploads real files without storage credentials', () => {
  assert.match(form, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(form, /x-content-sha256/);
  assert.match(form, /x-idempotency-key/);
  assert.match(form, /attachmentAssetIds/);
  assert.match(proxy, /resolveBrandContext\(\)/);
  assert.match(proxy, /redirect: 'error'/);
  assert.doesNotMatch(proxy, /STORAGE_TOKEN|SCANNER_TOKEN|SUPABASE|bucket/i);
});

test('learner and grader surfaces show persisted attachment evidence', () => {
  assert.match(form, /submission\.attachments/);
  assert.match(grader, /submission\.attachments/);
  assert.doesNotMatch(form, /setTimeout|mock|fixture/i);
});
