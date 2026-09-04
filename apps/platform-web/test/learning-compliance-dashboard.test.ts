import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-compliance.ts', import.meta.url), 'utf8');

test('compliance dashboard reads canonical tenant-scoped Learning records', () => {
  assert.match(runtime, /requireTenantModuleOperational/);
  assert.match(runtime, /tenantId: input\.tenantId/);
  for (const table of [
    'learning_learners',
    'learning_enrollments',
    'learning_program_enrollments',
    'learning_credentials',
  ]) assert.match(runtime, new RegExp(`platform\\.${table}`));
  assert.doesNotMatch(runtime, /INSERT|UPDATE|DELETE|appendDomainEvent/);
});

test('compliance risk is deterministic, bounded and driven by explicit dates', () => {
  assert.match(runtime, /input\.now \?\? new Date\(\)/);
  assert.match(runtime, /interval '30 days'/);
  assert.match(runtime, /due_at IS NOT NULL AND due_at < \$2/);
  assert.match(runtime, /credential\.status <> 'REVOKED'/);
  assert.match(runtime, /Math\.min\(250/);
  assert.match(runtime, /LIMIT \$3/);
});
