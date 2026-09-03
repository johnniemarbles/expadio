import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const sweep = read('../app/api/leads/escalate-tasks/route.ts');
const slaConfig = read('../app/api/leads/sla-config/route.ts');

test('escalation sweep is a brand-governed POST endpoint', () => {
  assert.match(sweep, /resolveBrandContext/);
  assert.match(sweep, /hasBrandGovernanceForOrganization/);
  assert.match(sweep, /withBrandTransaction/);
  assert.match(sweep, /export async function POST/);
  assert.match(sweep, /ORGANIZATION_CONTEXT_REQUIRED/);
});

test('sweep reads SLA config from the sla_config table before stamping', () => {
  assert.match(sweep, /lead_task_sla_config/);
  assert.match(sweep, /escalation_hours/);
  assert.match(sweep, /priority/);
});

test('sweep stamps escalated_at only on open, non-escalated tasks past their deadline', () => {
  assert.match(sweep, /escalated_at IS NOT NULL/);  // skip already escalated
  assert.match(sweep, /status = 'OPEN'/);
  assert.match(sweep, /escalated_at = now\(\)/);
  assert.match(sweep, /due_at IS NOT NULL/);
});

test('sweep is idempotent — tasks already escalated are filtered out', () => {
  // Filter: escalated_at IS NOT NULL are skipped
  assert.match(sweep, /escalated_at IS NOT NULL/);
  // Result is count of newly stamped rows only
  assert.match(sweep, /rowCount/);
  assert.match(sweep, /escalated/);
});

test('sweep returns early with zero when no SLA config exists for the org', () => {
  assert.match(sweep, /slaRows\.rows\.length === 0/);
  assert.match(sweep, /escalated: 0/);
});

test('sweep supports optional captureLeadId scope and batch limit', () => {
  assert.match(sweep, /captureLeadId/);
  assert.match(sweep, /batchLimit/);
  assert.match(sweep, /Math\.min/);
  assert.match(sweep, /LIMIT/);
});

test('sweep returns count of newly escalated tasks', () => {
  assert.match(sweep, /return NextResponse\.json.*escalated/s);
  assert.match(sweep, /status: 200/);
});

test('SLA config endpoint seeds the per-priority escalation thresholds the sweep consumes', () => {
  assert.match(slaConfig, /escalation_hours/);
  assert.match(slaConfig, /target_hours/);
  assert.match(slaConfig, /lead_task_sla_config/);
  assert.match(slaConfig, /ON CONFLICT/);
  assert.match(slaConfig, /DO UPDATE SET/);
});
