import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-actions.ts');
const verticals = read('../lib/verticals.ts');
const route = read('../app/api/governance/actions/route.ts');

test('every vertical is resolvable to its subject table for actions', () => {
  assert.match(verticals, /SUBJECT_TABLES/);
  for (const wt of ['crm\\.case', 'vendor\\.onboarding', 'expense\\.reimbursement', 'access\\.request']) {
    assert.match(verticals, new RegExp(`'${wt}':`));
  }
});

test('available actions derive from the current stage gates, read-only', () => {
  assert.match(lib, /resolveInstanceForSubject/);
  assert.match(lib, /SUBJECT_TABLES\[input\.workTypeKey\]/);
  assert.match(lib, /describeWorkflow/);
  // The three governed action types and their gate conditions.
  assert.match(lib, /type: 'ASSIGN'/);
  assert.match(lib, /type: 'DECIDE'/);
  assert.match(lib, /type: 'ADVANCE'/);
  assert.match(lib, /cur\.decisionRequired && described\.currentDecision === null/);
  // Terminal instances offer nothing.
  assert.match(lib, /COMPLETED', 'CANCELLED', 'FAILED'/);
});

test('the actions route is a membership read behind RLS keyed by work type + subject', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /availableActions/);
  assert.match(route, /searchParams\.get\('workType'\)/);
  assert.match(route, /searchParams\.get\('subject'\)/);
});
