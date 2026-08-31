import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0095_learning_competency_core.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-competency.ts');
const frameworks = read('../app/api/learning/competency-frameworks/route.ts');
const adminCompetencies = read('../app/api/learning/competencies/route.ts');
const adminReconcile = read('../app/api/learning/competencies/[learnerId]/reconcile/route.ts');
const mine = read('../app/api/learning/me/competencies/route.ts');
const mineReconcile = read('../app/api/learning/me/competencies/reconcile/route.ts');

test('competency administration is tenant-contextual and admin-only', () => {
  for (const source of [frameworks, adminCompetencies, adminReconcile]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
  }
});

test('learner competency routes bind authenticated subject and issuer', () => {
  for (const source of [mine, mineReconcile]) {
    assert.match(source, /subjectId: context\.subjectId/);
    assert.match(source, /subjectIssuer: context\.issuer \?\? null/);
    assert.doesNotMatch(source, /hasLearningAuthoringRole/);
    assert.doesNotMatch(source, /learnerId:/);
  }
});

test('published framework content is immutable and child edits are draft-only', () => {
  assert.match(migration, /non-draft learning competency framework versions are immutable/);
  assert.match(migration, /only draft learning competency framework versions may edit content/);
  assert.match(
    migration,
    /competency definitions, levels, and rules may mutate only while framework version is DRAFT/,
  );
  assert.match(
    migration,
    /learning competency evidence identity and observation are immutable/,
  );
});

test('all competency tenant-owned tables use FORCE RLS', () => {
  for (const table of [
    'learning_competency_frameworks',
    'learning_competency_framework_versions',
    'learning_competency_definitions',
    'learning_competency_levels',
    'learning_competency_evidence_rules',
    'learning_competency_evidence',
    'learning_competency_achievements',
  ]) {
    assert.match(
      migration,
      new RegExp('ALTER TABLE platform\\.' + table + ' FORCE ROW LEVEL SECURITY'),
    );
  }
});

test('competency reconciliation reuses existing learning evidence in batches', () => {
  assert.match(runtime, /platform\.learning_enrollments/);
  assert.match(runtime, /platform\.learning_assessment_attempts/);
  assert.match(runtime, /platform\.learning_program_enrollments/);
  assert.match(runtime, /platform\.learning_credentials/);
  assert.match(runtime, /Promise\.all/);
  assert.doesNotMatch(runtime, /for \(const rule of rules\)[\s\S]{0,600}client\.query/);
});

test('competency outcome events use existing domain-event outbox', () => {
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /learning\.competency\.achieved/);
  assert.match(runtime, /learning\.competency\.level\.changed/);
  assert.match(runtime, /learning\.competency\.lapsed/);
});

test('evidence history is distinct from current effective achievement', () => {
  assert.match(migration, /platform\.learning_competency_evidence/);
  assert.match(migration, /currently_valid boolean NOT NULL/);
  assert.match(migration, /platform\.learning_competency_achievements/);
  assert.match(migration, /status text NOT NULL DEFAULT 'ACTIVE'/);
  assert.match(runtime, /currently_valid = false/);
});
