import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0055_expense_reimbursement.sql');
const derivation = read('../lib/workflow-authority-derivation.ts');

test('the expense.reimbursement blueprint and table are seeded, RLS-forced', () => {
  assert.match(migration, /CREATE TABLE platform\.expense_reports/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /amount_minor_units bigint NOT NULL CHECK \(amount_minor_units > 0\)/);
  assert.match(migration, /NULL, 'expense\.reimbursement', 1/);
  assert.match(migration, /"stageKey": "MANAGER_REVIEW"/);
  assert.match(migration, /"requiredParticipantKeys": \["manager"\]/);
  assert.match(migration, /"decisionRequired": true/);
});

test('expense authority is derived from the expense\'s own amount, via the registry', () => {
  assert.match(derivation, /registerAuthorityDeriver\('expense\.reimbursement'/);
  assert.match(derivation, /platform\.expense_reports/);
  assert.match(derivation, /amount_minor_units/);
  assert.match(derivation, /monetary\.approval/);
  // A different basis than CRM: the expense's own amount, not an account agreement.
  assert.doesNotMatch(derivation.split("expenseReimbursementAuthorityDeriver")[1] ?? '', /crm_agreements/);
});
