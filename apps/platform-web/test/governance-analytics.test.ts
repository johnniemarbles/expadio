import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { approvalRate } from '../lib/governance-analytics.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('approvalRate is approvals over total, guarding division by zero', () => {
  assert.equal(approvalRate(0, 0), 0);
  assert.equal(approvalRate(3, 4), 0.75);
  assert.equal(approvalRate(1, 3), 0.3333);
  assert.equal(approvalRate(5, 5), 1);
});

test('the analytics query groups the decision log by work type and counts approvals', () => {
  const lib = read('../lib/governance-analytics.ts');
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  assert.match(lib, /GROUP BY work_type_key/);
  assert.match(lib, /FILTER \(WHERE outcome ILIKE '%APPROVE%'\)/);
});

test('the analytics route is a membership read behind RLS and the hub links to it', () => {
  const route = read('../app/api/governance/analytics/route.ts');
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadDecisionAnalytics/);
  const page = read('../app/(shell)/governance/analytics/page.tsx');
  assert.match(page, /Approval rate by work type/);
  const hub = read('../app/(shell)/governance/GovernanceToolsDirectory.tsx');
  const productNav = read('../lib/platform-product-surface.ts');
  assert.match(hub, /href: '\/governance\/analytics'/);
  assert.doesNotMatch(productNav, /href: '\/governance\/analytics'/);
  assert.match(page, /\/api\/tenancy\/vertical/);
  assert.match(page, /resolveWorkTypeLabel\(pack, s\.workTypeKey\)/);
  assert.match(page, /resolveWorkTypeLabel\(pack, cyc\.workTypeKey\)/);
});
