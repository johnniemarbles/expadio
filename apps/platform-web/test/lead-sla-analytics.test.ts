import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sla = read('../../../infra/db/migrations/0144_lead_task_sla.sql');
const analytics = read('../../../infra/db/migrations/0145_lead_analytics.sql');

test('task SLA migration adds priority + escalation with check constraints', () => {
  assert.match(sla, /ADD COLUMN priority text NOT NULL DEFAULT 'MEDIUM'/);
  assert.match(sla, /CHECK \(priority IN \('LOW','MEDIUM','HIGH','URGENT'\)\)/);
  assert.match(sla, /ADD COLUMN escalated_at timestamptz/);
  assert.match(sla, /lead_task_sla_config/);
  assert.match(sla, /target_hours.*>.*0/);
  assert.match(sla, /escalation_hours.*>=.*target_hours/);
});

test('SLA config table is org-scoped with RLS', () => {
  assert.match(sla, /FORCE ROW LEVEL SECURITY/);
  assert.match(sla, /current_context_can_access_organization/);
  assert.match(sla, /lead_task_sla_config_org/);
});

test('lead_task_sla_status function covers all SLA states', () => {
  assert.match(sla, /CREATE OR REPLACE FUNCTION platform\.lead_task_sla_status/);
  assert.match(sla, /'ESCALATED'/);
  assert.match(sla, /'OVERDUE'/);
  assert.match(sla, /'AT_RISK'/);
  assert.match(sla, /'ON_TRACK'/);
  assert.match(sla, /'N\/A'/);
});

test('analytics views use organization_closure for hierarchy-safe rollups', () => {
  assert.match(analytics, /platform\.organization_closure/);
  assert.match(analytics, /ancestor_id AS organization_id/);
  assert.match(analytics, /descendant_id = .*organization_id/);
  assert.match(analytics, /security_invoker = true/);
});

test('analytics covers funnel, task queue, activity volume, and attribution', () => {
  assert.match(analytics, /lead_capture_funnel_rollup/);
  assert.match(analytics, /lead_task_queue_rollup/);
  assert.match(analytics, /lead_activity_volume_rollup/);
  assert.match(analytics, /lead_attribution_source_rollup/);
});

test('funnel rollup breaks down verification states', () => {
  assert.match(analytics, /verification_state = 'VERIFIED'/);
  assert.match(analytics, /verification_state = 'UNVERIFIED'/);
  assert.match(analytics, /verification_state = 'NOT_REQUIRED'/);
});

test('task queue rollup flags overdue and escalated counts', () => {
  assert.match(analytics, /due_at < now\(\).*status = 'OPEN'/);
  assert.match(analytics, /escalated_at IS NOT NULL.*status = 'OPEN'/);
});
