import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-summary.ts');
const route = read('../app/api/governance/summary/route.ts');
const strip = read('../app/(shell)/governance/GovernanceSummaryStrip.tsx');
const page = read('../app/(shell)/governance/page.tsx');

test('the summary aggregates open instances and decisions, tenant-scoped', () => {
  assert.match(lib, /FROM platform\.workflow_instances/);
  assert.match(lib, /state NOT IN \('COMPLETED','CANCELLED','FAILED'\)/);
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  assert.match(lib, /GROUP BY outcome/);
});

test('the summary route is a membership read behind RLS', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadGovernanceSummary/);
});

test('the Governance Center shows the activity KPI strip linking to detail views', () => {
  assert.match(strip, /Awaiting you/);
  assert.match(strip, /In-flight work/);
  assert.match(strip, /Decisions recorded/);
  assert.match(strip, /\/governance\/queue/);
  assert.match(strip, /\/governance\/workflows/);
  assert.match(strip, /\/governance\/decisions/);
  assert.match(page, /GovernanceSummaryStrip/);
});
