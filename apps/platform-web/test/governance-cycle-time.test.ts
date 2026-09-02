import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatDuration } from '../lib/governance-cycle-time.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('formatDuration picks one compact unit', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(90), '2m');
  assert.equal(formatDuration(3_600), '1h');
  assert.equal(formatDuration(90_000), '25h'); // still hours below 48h
  assert.equal(formatDuration(180_000), '2d');
  assert.equal(formatDuration(-5), '0s');
});

test('cycle time pairs each decision with the latest transition into its stage', () => {
  const lib = read('../lib/governance-cycle-time.ts');
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  assert.match(lib, /workflow_instance_transitions/);
  assert.match(lib, /tr\.to_stage_key = d\.stage_key/);
  assert.match(lib, /tr\.transitioned_at <= d\.decided_at/);
  assert.match(lib, /GROUP BY d\.work_type_key/);
});

test('the cycle-time route is a membership read behind RLS and the analytics page shows it', () => {
  const route = read('../app/api/governance/cycle-time/route.ts');
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadDecisionCycleTime/);
  const page = read('../app/(shell)/governance/analytics/page.tsx');
  assert.match(page, /Time to decision by work type/);
  assert.match(page, /\/api\/governance\/cycle-time/);
});

test('the governance analytics page uses governed dashboard styling', () => {
  const page = read('../app/(shell)/governance/analytics/page.tsx');
  const pageStyles = read('../app/(shell)/governance/analytics/DecisionAnalytics.module.css');
  assert.match(page, /DecisionAnalytics\.module\.css/);
  assert.match(page, /<meter/);
  assert.match(page, /styles\.rateCell/);
  assert.match(page, /styles\.sectionGap/);
  assert.doesNotMatch(page, /React\.CSSProperties/);
  assert.doesNotMatch(page, /style=\{/);
  assert.doesNotMatch(page, /#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(pageStyles, /#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(pageStyles, /var\(--[^)\n]+,\s*[^)]+\)/);
  assert.match(pageStyles, /var\(--theme-success\)/);
  assert.match(pageStyles, /var\(--theme-warning\)/);
  assert.match(pageStyles, /var\(--theme-danger\)/);
});
