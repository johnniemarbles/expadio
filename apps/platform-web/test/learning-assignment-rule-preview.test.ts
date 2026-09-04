import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-assignment-automation.ts', import.meta.url), 'utf8');

test('assignment audience preview reuses the canonical rule validator and matcher', () => {
  assert.match(runtime, /previewLearningAssignmentRule/);
  assert.match(runtime, /validateLearningAssignmentRuleDraft\(input\.draft\)/);
  assert.match(runtime, /matchesLearningAssignmentRule/);
});

test('preview is tenant scoped, active-only, bounded and mutation free', () => {
  const start = runtime.indexOf('export async function previewLearningAssignmentRule');
  const end = runtime.indexOf('export async function listLearningAssignmentRules', start);
  const preview = runtime.slice(start, end);
  assert.match(preview, /tenant_id=\$1::uuid AND status='ACTIVE'/);
  assert.match(preview, /current_published_version IS NOT NULL/);
  assert.match(preview, /Math\.min\(100/);
  assert.match(preview, /matches\.slice\(0, sampleLimit\)/);
  assert.doesNotMatch(preview, /INSERT|UPDATE|DELETE|appendDomainEvent|createLearningEnrollment|createLearningProgramEnrollment/);
});
