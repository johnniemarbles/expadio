import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0055_expense_reimbursement.sql');
const derivation = read('../lib/workflow-authority-derivation.ts');
const listRoute = read('../app/api/expenses/route.ts');
const workflowRoute = read('../app/api/expenses/[id]/workflow/route.ts');
const decisionRoute = read('../app/api/expenses/[id]/workflow/decision/route.ts');
const client = read('../app/(shell)/expenses/ExpensesClient.tsx');
const nav = read('../app/api/workspaces/route.ts');

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

test('the expense routes are governed and run the generic runtime', () => {
  assert.match(listRoute, /export async function GET/);
  assert.match(listRoute, /export async function POST/);
  assert.match(listRoute, /INSERT INTO platform\.expense_reports/);
  assert.match(listRoute, /hasGovernanceWriteRole/);
  assert.match(workflowRoute, /createVerticalWorkflowRoute\(EXPENSE_WORKFLOW\)/);
  assert.match(decisionRoute, /createVerticalDecisionRoute\(EXPENSE_WORKFLOW\)/);
  // The expense's binding lives once in lib/verticals.ts.
  const verticals = read('../lib/verticals.ts');
  assert.match(verticals, /table: 'platform\.expense_reports'/);
  assert.match(verticals, /subjectType: 'expense\.reimbursement'/);
  assert.match(verticals, /stageKey === 'PAID' \? 'PAID' : 'SUBMITTED'/);
  // The shared factory carries the governed decision capture.
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /recordCaseDecision/);
});

test('the Expenses surface can file, review, approve and pay', () => {
  assert.match(client, /File expense/);
  assert.match(client, /Start review/);
  assert.match(client, /Assign manager/);
  assert.match(client, /Approve &amp; pay/);
  assert.match(client, /approveAndPay/);
  assert.match(nav, /href: '\/expenses'/);
});

test('the expense workflow exposes its governed trace', () => {
  const historyRoute = read('../app/api/expenses/[id]/workflow/history/route.ts');
  assert.match(historyRoute, /createVerticalHistoryRoute\(EXPENSE_WORKFLOW\)/);
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /loadCaseWorkflowHistory/);
  assert.match(client, /WorkflowTraceModal/);
  assert.match(client, /workflow\/history/);
});
