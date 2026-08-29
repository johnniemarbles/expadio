import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toInstancesCsv, INSTANCES_CSV_HEADER } from '../lib/governance-instances-csv.ts';
import type { GovernedInstance } from '../lib/governance-instances.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

function instance(over: Partial<GovernedInstance> = {}): GovernedInstance {
  return {
    workTypeKey: 'vendor.onboarding',
    subjectType: 'vendor',
    subjectId: 'v-1',
    state: 'RUNNING',
    currentStageKey: 'SCREENING',
    revision: 2,
    startedAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T01:00:00.000Z',
    ...over,
  };
}

test('the instances CSV has the header then one row per instance', () => {
  const csv = toInstancesCsv([instance()]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], INSTANCES_CSV_HEADER.join(','));
  assert.equal(lines[1], 'vendor.onboarding,vendor,v-1,RUNNING,SCREENING,2,2026-08-29T00:00:00.000Z,2026-08-29T01:00:00.000Z');
});

test('a null stage or start becomes an empty field', () => {
  const csv = toInstancesCsv([instance({ currentStageKey: null, startedAt: null })]);
  assert.equal(csv.split('\r\n')[1], 'vendor.onboarding,vendor,v-1,RUNNING,,2,,2026-08-29T01:00:00.000Z');
});

test('the workflows export route is a membership read behind RLS and the page links to it', () => {
  const route = read('../app/api/governance/workflows/export/route.ts');
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadTenantInstances/);
  assert.match(route, /toInstancesCsv/);
  assert.match(route, /text\/csv/);
  assert.match(route, /attachment; filename="in-flight-workflows\.csv"/);
  const client = read('../app/(shell)/governance/workflows/WorkflowsClient.tsx');
  assert.match(client, /\/api\/governance\/workflows\/export/);
  assert.match(client, /Download CSV/);
});
