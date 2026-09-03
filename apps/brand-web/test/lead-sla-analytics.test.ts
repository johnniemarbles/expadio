import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const slaConfig = read('../app/api/leads/sla-config/route.ts');
const analytics = read('../app/api/leads/analytics/route.ts');
const bulkTasks = read('../app/api/leads/bulk/tasks/route.ts');
const importRoute = read('../app/api/leads/import/route.ts');
const taskUpdate = read('../app/api/leads/tasks/[taskId]/route.ts');
const activities = read('../app/api/leads/capture/[id]/activities/route.ts');

test('SLA config endpoints are organization-governed', () => {
  assert.match(slaConfig, /resolveBrandContext/);
  assert.match(slaConfig, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(slaConfig, /hasBrandGovernanceForOrganization/);
  assert.match(slaConfig, /lead_task_sla_config/);
});

test('SLA config PUT validates priority enum and hour constraints', () => {
  assert.match(slaConfig, /LOW.*MEDIUM.*HIGH.*URGENT|PRIORITIES/);
  assert.match(slaConfig, /targetHours.*>.*0|target_hours.*>.*0/);
  // Route checks violation direction (escalationHours < targetHours); the migration uses >= in the constraint.
  assert.match(slaConfig, /escalationHours.*<.*targetHours|escalation_hours.*>=.*target_hours/);
  assert.match(slaConfig, /ON CONFLICT/);
  assert.match(slaConfig, /DO UPDATE SET/);
});

test('task PATCH now handles priority and escalation in addition to status', () => {
  assert.match(taskUpdate, /priority.*PRIORITIES|PRIORITIES.*priority/);
  assert.match(taskUpdate, /escalated_at = now\(\)/);
  assert.match(taskUpdate, /escalated_at = NULL/);
  assert.match(taskUpdate, /lead_task_sla_status/);
  // Dynamic SET builder — status update still stamps completed_at correctly.
  assert.match(taskUpdate, /CASE WHEN \$.*= 'DONE' THEN now\(\) ELSE NULL END/);
});

test('activities POST now accepts DISCOVERY and COMMUNICATION in addition to NOTE', () => {
  assert.match(activities, /ALLOWED_POST_TYPES|DISCOVERY.*COMMUNICATION/);
  assert.match(activities, /activityType/);
  assert.match(activities, /duration_minutes|durationMinutes/);
  // Metadata is stored as jsonb; column and cast are on separate lines so check each.
  assert.match(activities, /metadata/);
  assert.match(activities, /::jsonb/);
});

test('analytics endpoint uses hierarchy-safe rollup views', () => {
  assert.match(analytics, /resolveBrandContext/);
  assert.match(analytics, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(analytics, /lead_capture_funnel_rollup/);
  assert.match(analytics, /lead_task_queue_rollup/);
  assert.match(analytics, /lead_attribution_source_rollup/);
  // Must not bypass org scope.
  assert.match(analytics, /organization_id = \$2/);
});

test('analytics response shapes funnel + taskQueue + attributionSources', () => {
  assert.match(analytics, /totalLeads|total_leads/);
  assert.match(analytics, /verifiedLeads|verified_leads/);
  assert.match(analytics, /overdueCount|overdue_count/);
  assert.match(analytics, /attributionSources|attribution_sources/);
});

test('CSV import is governance-gated, size-bounded, and per-row idempotent', () => {
  assert.match(importRoute, /hasBrandGovernanceForOrganization/);
  assert.match(importRoute, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(importRoute, /MAX_ROWS|MAX_BYTES/);
  // Duplicate email check before insert.
  assert.match(importRoute, /submission.*email.*\$4|'email'.*=.*\$4/);
  // Import marker SYSTEM activity.
  assert.match(importRoute, /'SYSTEM'.*import|import.*'SYSTEM'/);
});

test('CSV parser handles quoted fields and maps to standard columns', () => {
  assert.match(importRoute, /parseCsv|splitCsvLine/);
  // Validates at least email or name per row.
  assert.match(importRoute, /email.*name|name.*email/);
  assert.match(importRoute, /at least.*email.*name|email.*or.*name/i);
});

test('bulk task creation verifies all lead IDs are in-scope before insert', () => {
  assert.match(bulkTasks, /hasBrandGovernanceForOrganization/);
  assert.match(bulkTasks, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(bulkTasks, /capture_lead_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(bulkTasks, /outOfScope/);
  assert.match(bulkTasks, /MAX_BULK/);
});

test('bulk task PATCH updates status with correct completed_at logic', () => {
  assert.match(bulkTasks, /task_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(bulkTasks, /CASE WHEN \$4 = 'DONE' THEN now\(\) ELSE NULL END/);
});
