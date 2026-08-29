import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toDecisionsCsv, DECISIONS_CSV_HEADER } from '../lib/governance-decisions-csv.ts';
import type { GovernedDecision } from '../lib/governance-decisions.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

function decision(over: Partial<GovernedDecision> = {}): GovernedDecision {
  return {
    decidedAt: '2026-08-29T00:00:00.000Z',
    workTypeKey: 'vendor.onboarding',
    subjectType: 'vendor',
    subjectId: 'v-1',
    stageKey: 'APPROVAL',
    outcome: 'APPROVE',
    decidedBySubjectId: 'approver',
    code: 'WORKFLOW_DECISION_COMMITTED',
    evidenceRefs: ['role:ok', 'sod:ok'],
    instanceState: 'RUNNING',
    ...over,
  };
}

test('the CSV has the header row then one line per decision, fields in order', () => {
  const csv = toDecisionsCsv([decision()]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], DECISIONS_CSV_HEADER.join(','));
  assert.equal(lines[1], '2026-08-29T00:00:00.000Z,vendor.onboarding,vendor,v-1,APPROVAL,APPROVE,approver,WORKFLOW_DECISION_COMMITTED,role:ok; sod:ok,RUNNING');
  // Ends on a record boundary (trailing CRLF -> empty final element).
  assert.equal(lines[lines.length - 1], '');
});

test('fields with commas, quotes or newlines are RFC 4180 quoted', () => {
  const csv = toDecisionsCsv([decision({ subjectId: 'a,b', decidedBySubjectId: 'say "hi"', stageKey: 'line1\nline2' })]);
  const row = csv.split('\r\n')[1];
  assert.match(row, /"a,b"/);
  assert.match(row, /"say ""hi"""/);
  assert.match(row, /"line1\nline2"/);
});

test('an empty log still emits the header', () => {
  assert.equal(toDecisionsCsv([]), `${DECISIONS_CSV_HEADER.join(',')}\r\n`);
});

test('the export route streams tenant-scoped CSV and the log links to it', () => {
  const route = read('../app/api/governance/decisions/export/route.ts');
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadTenantDecisions/);
  assert.match(route, /toDecisionsCsv/);
  assert.match(route, /text\/csv/);
  assert.match(route, /content-disposition/);
  assert.match(route, /attachment; filename="governed-decisions/);
  const client = read('../app/(shell)/governance/decisions/DecisionsClient.tsx');
  assert.match(client, /\/api\/governance\/decisions\/export/);
  assert.match(client, /Download CSV/);
});
