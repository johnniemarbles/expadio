import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0097_learning_governed_automation_rules.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-automation.ts');
const materializer = read('../lib/learning-governed-actions.ts');
const worker = read('../lib/domain-event-action-worker.ts');
const collection = read('../app/api/learning/automation-rules/route.ts');
const item = read('../app/api/learning/automation-rules/[id]/route.ts');

test('automation administration is tenant contextual and admin only', () => {
  for (const source of [collection, item]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
  }
});

test('Learning automation stores configuration only and creates no parallel execution spine', () => {
  assert.match(migration, /CREATE TABLE platform\.learning_automation_rules/);
  assert.doesNotMatch(migration, /CREATE TABLE platform\.learning_.*outbox/);
  assert.doesNotMatch(migration, /CREATE TABLE platform\.learning_.*queue/);
  assert.doesNotMatch(migration, /CREATE TABLE platform\.learning_.*schedule/);

  assert.match(worker, /materializeLearningGovernedActionsForEvent/);
  assert.match(worker, /executeGovernedCreateTaskAction/);
  assert.match(worker, /executeGovernedCommunicateAction/);
  assert.match(worker, /executeGovernedScheduleAction/);
  assert.match(worker, /claimDomainEventOutbox/);
});

test('automation rules are tenant isolated and revision guarded', () => {
  assert.match(
    migration,
    /ALTER TABLE platform\.learning_automation_rules FORCE ROW LEVEL SECURITY/,
  );
  assert.match(migration, /learning automation rule revision must increment exactly once/);
  assert.match(migration, /learning_automation_enabled_policy_evaluator/);
  assert.match(migration, /learning automation rule identity and creation provenance are immutable/);
  assert.match(runtime, /LEARNING_AUTOMATION_RULE_REVISION_CONFLICT/);
});

test('only already-proven worker executors are accepted', () => {
  assert.match(migration, /executor_class IN \('CREATE_TASK','COMMUNICATE','SCHEDULE'\)/);
  assert.match(runtime, /validateLearningAutomationRuleDraft/);
});

test('Learning materializer uses shared governed action resolution and persistence', () => {
  assert.match(materializer, /materializeGovernedActionRule/);
  assert.match(materializer, /resolveGovernedAction/);
  assert.match(materializer, /persistGovernedActionIntent/);
  assert.match(materializer, /loadDomainEvent/);
  assert.match(materializer, /learnerSubjectId/);
  assert.match(materializer, /learnerEmail/);
});

test('Learning automation fails closed for policy-bearing rules without evaluator', () => {
  assert.match(materializer, /POLICY_EVALUATOR_REQUIRED/);
  assert.match(materializer, /Governed action policy refused this Learning action/);
});

test('commercial suspension consumes old events without executing Learning rules', () => {
  assert.match(runtime, /loadTenantProductModule/);
  assert.match(runtime, /module\.availability !== 'ACTIVE'/);
  assert.match(runtime, /return \[\]/);
  assert.match(worker, /loadTenantProductModule/);
  assert.match(worker, /aggregateType === 'learning\.learner'/);
  assert.match(worker, /eventType === 'learning\.learner\.created'/);
});
