import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0105_enterprise_control_plane.sql');
const runtime = read('../../../packages/postgres-runtime/src/enterprise.ts');
const requestContext = read('../lib/request-context.ts');
const contextRoute = read('../app/api/context/route.ts');
const organizationList = read('../app/api/organizations/list/route.ts');
const organizationRoute = read('../app/api/organizations/route.ts');
const decisionRoute = read('../app/api/enterprise/change-requests/[id]/decision/route.ts');

test('enterprise persistence keeps tenant, enterprise, legal entity, and organization distinct', () => {
  for (const table of [
    'enterprise_profiles',
    'legal_entities',
    'legal_entity_registration_identifiers',
    'legal_entity_addresses',
    'legal_entity_classifications',
    'legal_entity_business_functions',
    'ownership_interests',
    'beneficial_owners',
    'organization_legal_entity_bindings',
    'enterprise_change_requests',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE platform\\.${table}`));
  }
  assert.match(migration, /ALTER TABLE platform\.organizations\s+ADD COLUMN enterprise_id uuid/);
  assert.match(migration, /organizations_parent_same_enterprise_fk/);
  assert.doesNotMatch(migration, /ALTER TABLE platform\.crm_accounts.*legal_entity/is);
});

test('organization and legal parent hierarchies fail closed on cycles', () => {
  assert.match(migration, /organization_parent_would_cycle/);
  assert.match(migration, /organizations_reject_cycles/);
  assert.match(migration, /legal_entity_parent_would_cycle/);
  assert.match(migration, /legal_entities_reject_cycles/);
  assert.match(migration, /CREATE TABLE platform\.organization_closure/);
});

test('hierarchical membership expands through existing IAM bootstrap', () => {
  assert.match(migration, /organization_scope_mode IN \('SELF','DESCENDANTS','SELF_AND_DESCENDANTS','SELECTED'\)/);
  assert.match(migration, /CREATE TABLE platform\.membership_organizations/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.active_memberships_for_subject/);
  assert.match(migration, /organization_scope_mode IN \('DESCENDANTS','SELF_AND_DESCENDANTS'\)/);
  assert.match(migration, /organization_closure_subject_bootstrap_select/);
});

test('every new tenant-scoped enterprise table is FORCE RLS protected', () => {
  for (const table of [
    'enterprise_profiles',
    'legal_entities',
    'legal_entity_registration_identifiers',
    'legal_entity_addresses',
    'legal_entity_classifications',
    'legal_entity_business_functions',
    'ownership_interests',
    'beneficial_owners',
    'organization_legal_entity_bindings',
    'organization_closure',
    'membership_organizations',
    'enterprise_change_requests',
  ]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE platform\\.${table} FORCE ROW LEVEL SECURITY`),
    );
  }
});

test('legal registration identity is deduplicated at the database boundary', () => {
  assert.match(migration, /legal_entity_registration_identity_uq/);
  assert.match(migration, /upper\(jurisdiction_code\)/);
  assert.match(migration, /normalized_identifier/);
});

test('child organization creation is a governed request, not a direct active insert', () => {
  assert.match(organizationList, /requestChildOrganization/);
  assert.match(organizationList, /Idempotency-Key header is required/);
  assert.doesNotMatch(organizationList, /INSERT INTO platform\.organizations/);
  assert.match(runtime, /enterprise\.change_request\.submitted/);
  assert.match(runtime, /organization\.provisioned/);
  assert.match(runtime, /'PROVISIONING'/);
});

test('approval and activation remain separate and separation of duties is default', () => {
  assert.match(decisionRoute, /approveCreateOrganizationRequest/);
  assert.match(decisionRoute, /allowSelfApproval: false/);
  assert.match(runtime, /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/);
  assert.doesNotMatch(runtime, /organizationId[\s\S]*'ACTIVE'/);
});

test('request context and shell contain no demo organization fallback or tenant-wide org grant', () => {
  assert.doesNotMatch(
    requestContext,
    /requestedOrganizationId[\s\S]*00000000-0000-0000-0000-000000000002/,
  );
  assert.match(requestContext, /return context\.organizationId/);
  assert.match(requestContext, /if \(requestedOrganization\)[\s\S]*if \(!selectedMembership\)[\s\S]*TENANT_ACCESS_DENIED/);
  assert.match(requestContext, /else if \(requestedTenant\)[\s\S]*if \(!selectedMembership\)[\s\S]*TENANT_ACCESS_DENIED/);
  assert.match(contextRoute, /allowedOrganizationIds/);
  assert.match(contextRoute, /organization_id = ANY\(\$1::uuid\[\]\)/);
  assert.match(contextRoute, /parentId: row\.parent_organization_id \?\? null/);
  assert.doesNotMatch(contextRoute, /parentId: null,/);
  assert.doesNotMatch(organizationRoute, /00000000-0000-0000-0000-00000000000[12]/);
  assert.doesNotMatch(organizationList, /00000000-0000-0000-0000-00000000000[12]/);
});
