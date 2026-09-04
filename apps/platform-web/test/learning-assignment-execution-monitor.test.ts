import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-assignment-automation.ts', import.meta.url), 'utf8');

test('execution monitor is tenant-scoped, bounded and newest-first', () => {
  const start = runtime.indexOf('export async function listLearningAssignmentRuleExecutions');
  const end = runtime.indexOf('export async function evaluateLearningAssignmentRulesForLearner', start);
  const monitor = runtime.slice(start, end);
  assert.match(monitor, /requireLearning\(client, input\.tenantId\)/);
  assert.match(monitor, /execution\.tenant_id=\$1::uuid/);
  assert.match(monitor, /Math\.min\(500/);
  assert.match(monitor, /ORDER BY execution\.evaluated_at DESC/);
  assert.match(monitor, /LIMIT \$2/);
  assert.doesNotMatch(monitor, /INSERT|UPDATE|DELETE|appendDomainEvent/);
});

test('execution monitor preserves rule, learner, outcome and audit correlation evidence', () => {
  assert.match(runtime, /rule\.rule_key/);
  assert.match(runtime, /learner\.full_name AS learner_name/);
  assert.match(runtime, /execution\.outcome/);
  assert.match(runtime, /execution\.trigger_event_id/);
  assert.match(runtime, /execution\.correlation_id/);
  assert.match(runtime, /execution\.enrollment_id/);
  assert.match(runtime, /execution\.program_enrollment_id/);
});
