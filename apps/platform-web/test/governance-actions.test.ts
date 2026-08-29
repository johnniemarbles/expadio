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
  // The queue's actionable set is exactly the two the POST endpoint performs.
  assert.match(lib, /type: 'ASSIGN'/);
  assert.match(lib, /type: 'DECIDE'/);
  assert.match(lib, /cur\.decisionRequired && described\.currentDecision === null/);
  // Advancing is not a queue action but a readiness status — no target stages
  // are advertised that the runtime might reject (the read model projects the
  // write model exactly).
  assert.doesNotMatch(lib, /type: 'ADVANCE'/);
  assert.match(lib, /const canAdvance = unmet\.length === 0 && !needsDecision/);
  // Terminal instances offer nothing and cannot advance.
  assert.match(lib, /COMPLETED', 'CANCELLED', 'FAILED'/);
  assert.match(lib, /actions: \[\], canAdvance: false/);
});

test('the actions route is a membership read behind RLS keyed by work type + subject', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /availableActions/);
  assert.match(route, /searchParams\.get\('workType'\)/);
  assert.match(route, /searchParams\.get\('subject'\)/);
});

test('the actions route POST performs a governed DECIDE or ASSIGN, role-gated', () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /hasCrmWriteRole/);
  assert.match(route, /decideOnSubject/);
  assert.match(route, /assignOnSubject/);
  assert.match(route, /Action must be DECIDE or ASSIGN/);
});

test('the mutation helpers resolve the instance then use the governed primitives', () => {
  // DECIDE goes through recordCaseDecision (role + SoD + any authority deriver).
  assert.match(lib, /export async function decideOnSubject/);
  assert.match(lib, /makerForStage/);
  assert.match(lib, /recordCaseDecision/);
  // ASSIGN goes through assignParticipant.
  assert.match(lib, /export async function assignOnSubject/);
  assert.match(lib, /assignParticipant/);
});
