import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-decisions.ts');
const route = read('../app/api/governance/decisions/route.ts');
const client = read('../app/(shell)/governance/decisions/DecisionsClient.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('the decisions read joins the immutable log to instances, tenant-scoped', () => {
  assert.match(lib, /platform\.workflow_stage_decisions/);
  assert.match(lib, /JOIN platform\.workflow_instances/);
  assert.match(lib, /ORDER BY d\.decided_at DESC/);
  // Filterable by work type; the join carries subject + evidence for oversight.
  assert.match(lib, /work_type_key = \$1/);
  assert.match(lib, /evidence_refs/);
});

test('the governed-decisions route is a membership read behind RLS', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadTenantDecisions/);
});

test('the oversight surface lists and filters decisions', () => {
  assert.match(client, /Governed decisions/);
  assert.match(client, /All work types/);
  assert.match(client, /Evidence/);
  assert.match(nav, /href: '\/governance\/decisions'/);
});

test('the decision log work type and stage speak the active pack language', () => {
  const page = read('../app/(shell)/governance/decisions/page.tsx');
  assert.match(page, /\/api\/tenancy\/vertical/);
  assert.match(page, /verticalKey=\{verticalKey\}/);
  assert.match(client, /findIndustryPack, resolveWorkTypeLabel, resolveStageLabel/);
  assert.match(client, /resolveWorkTypeLabel\(pack, d\.workTypeKey\)/);
  assert.match(client, /resolveStageLabel\(pack, d\.workTypeKey, d\.stageKey\)/);
});
