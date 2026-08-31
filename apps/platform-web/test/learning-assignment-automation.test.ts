import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0096_learning_assignment_automation.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-assignment-automation.ts');
const enrollment = read('../../../packages/postgres-runtime/src/learning-enrollment.ts');
const worker = read('../lib/domain-event-action-worker.ts');
const rules = read('../app/api/learning/assignment-rules/route.ts');
const executions = read('../app/api/learning/assignment-rule-executions/route.ts');

test('learner creation emits a minimal transactional domain event', () => {
  assert.match(enrollment, /learning\.learner\.created/);
  assert.match(enrollment, /appendDomainEventWithOutbox/);
  assert.match(enrollment, /subjectBound: row\.subject_id !== null/);
  assert.doesNotMatch(
    enrollment.slice(
      enrollment.indexOf("eventType: 'learning.learner.created'"),
      enrollment.indexOf("eventType: 'learning.learner.created'") + 1000,
    ),
    /email|metadata/,
  );
});

test('domain event worker executes only learner-created learning automation', () => {
  assert.match(worker, /aggregateType === 'learning\.learner'/);
  assert.match(worker, /eventType === 'learning\.learner\.created'/);
  assert.match(worker, /evaluateLearningAssignmentRulesForLearner/);
  assert.match(worker, /completeDomainEventOutbox/);
  assert.match(worker, /client\.query\('BEGIN'\)/);
  assert.match(worker, /client\.query\('COMMIT'\)/);
  assert.match(worker, /system:learning-assignment-automation/);
});

test('assignment rule administration remains tenant-contextual and admin-only', () => {
  for (const source of [rules, executions]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
  }
});

test('published rule policy is immutable and executions are append-only', () => {
  assert.match(migration, /non-draft learning assignment rule versions are immutable/);
  assert.match(migration, /only draft learning assignment rule versions may edit policy/);
  assert.match(migration, /learning assignment rule executions are append-only/);
  assert.match(
    migration,
    /UNIQUE \(tenant_id, assignment_rule_version_id, learner_id\)/,
  );
});

test('assignment automation uses FORCE RLS', () => {
  for (const table of [
    'learning_assignment_rules',
    'learning_assignment_rule_versions',
    'learning_assignment_rule_executions',
  ]) {
    assert.match(
      migration,
      new RegExp('ALTER TABLE platform\\.' + table + ' FORCE ROW LEVEL SECURITY'),
    );
  }
});

test('evaluation is serialized and prevents duplicate target assignment', () => {
  assert.match(runtime, /pg_advisory_xact_lock/);
  assert.match(runtime, /status IN \('ASSIGNED','IN_PROGRESS','COMPLETED'\)/);
  assert.match(runtime, /SATISFIED/);
  assert.match(runtime, /ON CONFLICT \(tenant_id, assignment_rule_version_id, learner_id\)/);
  assert.match(runtime, /sourceType: 'RULE'/);
});
