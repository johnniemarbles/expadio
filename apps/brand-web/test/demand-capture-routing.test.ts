import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0128_demand_capture_routing.sql');
const executor = read('../lib/demand-capture-routing.ts');
const routeNow = read('../app/api/leads/capture/[id]/routing/route.ts');
const rules = read('../app/api/leads/capture/routing-rules/route.ts');
const ruleStatus = read('../app/api/leads/capture/routing-rules/[ruleId]/route.ts');
const inbox = read('../app/(workspace)/leads/capture/DemandCaptureClient.tsx');
const routingPage = read('../app/(workspace)/leads/capture/routing/RoutingRulesClient.tsx');

test('Demand Capture routing is deterministic and organization scoped', () => {
  assert.match(migration, /lead_capture_routing_rules/);
  assert.match(migration, /UNIQUE \(tenant_id, organization_id, priority\)/);
  assert.match(migration, /source_id uuid/);
  assert.match(migration, /target_subject_id text NOT NULL/);
  assert.match(migration, /current_context_can_access_organization/);
  assert.match(executor, /ORDER BY priority ASC, routing_rule_id ASC/);
  assert.match(executor, /for \(const rule of rules\.rows\)/);
  assert.match(executor, /subject_can_access_organization/);
});

test('routing targets are validated without changing or escaping current request scope', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.subject_can_access_organization/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /p_tenant_id = platform\.current_tenant_id\(\)/);
  assert.match(migration, /current_context_can_access_organization\(p_tenant_id, p_organization_id\)/);
  assert.match(migration, /membership\.subject_id = p_subject_id/);
  assert.match(migration, /membership\.issuer IS NOT DISTINCT FROM p_issuer/);
  assert.doesNotMatch(migration, /set_config\('app\.subject_id'/);
});

test('routing mutations require active Lead Management and Brand governance', () => {
  for (const source of [routeNow, rules, ruleStatus]) {
    assert.match(source, /loadTenantProductModule/);
    assert.match(source, /moduleKey: 'lead-management'/);
    assert.match(source, /availability !== 'ACTIVE'/);
    assert.match(source, /hasBrandGovernanceForOrganization/);
    assert.doesNotMatch(source, /body\.tenantId/);
    assert.doesNotMatch(source, /body\.organizationId/);
  }
  assert.doesNotMatch(routeNow, /body\.owner/);
  assert.doesNotMatch(routeNow, /body\.targetSubject/);
  assert.match(rules, /ROUTING_TARGET_NOT_ELIGIBLE/);
  assert.match(rules, /ROUTING_PRIORITY_CONFLICT/);
});

test('assignment results are append-only and UNASSIGNED is first-class', () => {
  assert.match(migration, /lead_capture_assignment_events/);
  assert.match(migration, /outcome IN \('ASSIGNED','UNASSIGNED'\)/);
  assert.match(migration, /lead capture assignment events are append-only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /UNASSIGNED is an explicit auditable result/);
  assert.match(executor, /NO_VALID_ROUTE/);
  assert.match(executor, /replayed/);
  assert.match(inbox, /Route now/);
  assert.match(inbox, /UNASSIGNED/);
  assert.match(routingPage, /No routing rules exist/);
  assert.match(routingPage, /Create governed routing rule/);
});
