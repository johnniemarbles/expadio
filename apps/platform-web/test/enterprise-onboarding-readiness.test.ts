import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0111_organization_setup_readiness.sql');
const runtime = read('../../../packages/postgres-runtime/src/enterprise-onboarding.ts');
const enterpriseRuntime = read('../../../packages/postgres-runtime/src/enterprise.ts');
const setupContext = read('../lib/enterprise-setup-context.ts');
const requirementRoute = read(
  '../app/api/enterprise/setup/plans/[planId]/requirements/[requirementId]/route.ts',
);
const participantRoute = read(
  '../app/api/enterprise/setup/plans/[planId]/participants/route.ts',
);
const activationRoute = read(
  '../app/api/enterprise/setup/plans/[planId]/activate/route.ts',
);
const governanceAuthz = read('../lib/governance-authz.ts');
const decisionRoute = read(
  '../app/api/enterprise/change-requests/[id]/decision/route.ts',
);
const organizationsRoute = read('../app/api/organizations/list/route.ts');
const setupLanding = read('../app/enterprise-setup/EnterpriseSetupLanding.tsx');
const setupWorkspace = read(
  '../app/enterprise-setup/[planId]/OrganizationSetupWorkspace.tsx',
);
const organizationsPage = read('../app/(shell)/organizations/page.tsx');

test('onboarding migration uses valid dollar-quoted function bodies', () => {
  assert.doesNotMatch(migration, /LANGUAGE (?:sql|plpgsql)[\\s\\S]{0,120}AS \\$(?:\\r?\\n)/);
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 8);
});

test('organization setup is persisted separately from normal active membership', () => {
  for (const table of [
    'organization_setup_plans',
    'organization_setup_requirements',
    'organization_setup_requirement_dependencies',
    'organization_setup_participants',
    'organization_setup_events',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE platform\\.${table}`));
    assert.match(
      migration,
      new RegExp(`ALTER TABLE platform\\.${table} FORCE ROW LEVEL SECURITY`),
    );
  }

  assert.match(runtime, /handoffSetupOwnerMembership/);
  assert.match(runtime, /INSERT INTO platform\.memberships/);
  assert.match(runtime, /organization_scope_mode, valid_until/);
  assert.match(runtime, /'ACTIVE', 'ALL', 'ALL', 'SELF'/);
  assert.match(runtime, /authorizationRolesGranted: \[\]/);
  assert.match(
    runtime,
    /UPDATE platform\.organizations[\s\S]*status = 'ACTIVE'[\s\S]*handoffSetupOwnerMembership/,
  );
  assert.match(setupContext, /organization_setup_participants/);
  assert.match(setupContext, /app\.subject_id/);
  assert.match(setupContext, /app\.tenant_id/);
  assert.match(
    setupContext,
    /const contexts:[\s\S]*app\.tenant_id[\s\S]*await client\.query\('COMMIT'\);[\s\S]*return contexts/,
  );
});


test('approved child automatically enters persisted configuration journey', () => {
  assert.match(enterpriseRuntime, /startOrganizationSetup/);
  assert.match(enterpriseRuntime, /provisioningChangeRequestId: input\.requestId/);
  assert.match(runtime, /core\.organization-profile/);
  assert.match(runtime, /core\.operating-entity/);
  assert.match(runtime, /core\.primary-administrator/);
  assert.match(runtime, /organization\.setup\.started/);
});

test('readiness cannot be bypassed by direct organization or plan state mutation', () => {
  assert.match(migration, /organizations_enforce_setup_activation_gate/);
  assert.match(migration, /organization activation requires activated setup plan/);
  assert.match(migration, /organization_setup_plans_enforce_transition/);
  assert.match(migration, /setup plan activation requires ready state/);
  assert.match(migration, /blocking_open_requirements <> 0/);
  assert.match(runtime, /ORGANIZATION_SETUP_READINESS_INVARIANT_FAILED/);
  assert.match(runtime, /satisfactionMode: 'AUTOMATED'/);
  assert.match(runtime, /evaluateOrganizationSetupAutomatedRequirements/);
  assert.match(runtime, /ORGANIZATION_SETUP_AUTOMATED_REQUIREMENT/);
  assert.match(runtime, /ORGANIZATION_SETUP_EVIDENCE_REQUIRED/);
  assert.match(runtime, /ORGANIZATION_SETUP_PRIMARY_ADMIN_REQUIRED/);
  assert.match(runtime, /ORGANIZATION_SETUP_PRIMARY_ADMIN_OWNER_REQUIRED/);
  assert.match(runtime, /designateOrganizationSetupPrimaryAdministrator/);
  assert.match(runtime, /primaryAdministratorSubjectId/);
  assert.match(runtime, /ORGANIZATION_SETUP_ACCESS_HANDOFF_CONFLICT/);
});

test('requirements are dependency-aware, idempotent, and event-backed', () => {
  assert.match(migration, /organization_setup_dependencies_reject_cycles/);
  assert.match(runtime, /ORGANIZATION_SETUP_DEPENDENCIES_INCOMPLETE/);
  assert.match(runtime, /REQUIREMENT_DEPENDENCY_ADDED/);
  assert.match(runtime, /organization\.setup\.requirement_dependency_added/);
  assert.match(runtime, /organization\.setup\.operating_entity_assigned/);
  assert.match(runtime, /organization_legal_entity_bindings/);
  assert.match(runtime, /legal_entity\.status = 'VERIFIED'/);
  assert.match(runtime, /ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT/);
  assert.match(runtime, /REQUIREMENT_ADDED/);
  assert.match(runtime, /REQUIREMENT_STATUS_CHANGED/);
  assert.match(runtime, /organization\.setup\.requirement_added/);
  assert.match(runtime, /organization\.setup\.requirement_changed/);
  assert.match(migration, /organization setup events are append-only/);
});

test('human setup roles are bounded and cannot impersonate module or vertical injection', () => {
  assert.match(requirementRoute, /roleAllows/);
  assert.match(participantRoute, /context\.role !== 'OWNER'/);
  const addRoute = read(
    '../app/api/enterprise/setup/plans/[planId]/requirements/route.ts',
  );
  assert.match(addRoute, /ALLOWED_SOURCES/);
  assert.match(addRoute, /ALLOWED_SOURCES = new Set\(\['CUSTOM'\]\)/);
  assert.doesNotMatch(addRoute, /ALLOWED_SOURCES[^\n]*PARENT_POLICY/);
  assert.doesNotMatch(addRoute, /ALLOWED_SOURCES[^\n]*TENANT/);
  assert.match(addRoute, /ALLOWED_SATISFACTION_MODES = new Set\(\['MANUAL', 'EVIDENCE'\]\)/);
  assert.match(addRoute, /must be injected by their governing runtime/);
});

test('parent-governed enterprise mutations require organization-scoped authority', () => {
  assert.match(governanceAuthz, /hasGovernanceWriteRoleForOrganization/);
  assert.match(governanceAuthz, /a\.organization_id IS NULL OR a\.organization_id = \$3::uuid/);
  assert.match(governanceAuthz, /action_organization_ids IS NULL/);
  assert.match(governanceAuthz, /\$3::uuid = ANY\(a\.action_organization_ids\)/);
  assert.match(decisionRoute, /hasGovernanceWriteRoleForOrganization/);
  assert.match(organizationsRoute, /hasGovernanceWriteRoleForOrganization/);
  assert.match(activationRoute, /hasGovernanceWriteRoleForOrganization/);
});

test('final activation requires active ancestor governance scope', () => {
  assert.match(activationRoute, /hasGovernanceWriteRoleForOrganization/);
  assert.match(activationRoute, /organization_closure/);
  assert.match(activationRoute, /closure\.depth > 0/);
  assert.match(activationRoute, /activateOrganizationSetup/);
  assert.match(runtime, /organization\.setup\.activated/);
  assert.match(runtime, /organization\.activated/);
  assert.match(runtime, /SET status = 'ACTIVE'/);
});

test('pre-activation setup discovery is subject scoped under FORCE RLS', () => {
  assert.match(migration, /organization_setup_participants_subject_bootstrap_select/);
  assert.match(migration, /organization_setup_plans_subject_bootstrap_select/);
  assert.match(migration, /subject_id = platform\.current_subject_id\(\)/);
  assert.match(migration, /issuer IS NOT DISTINCT FROM platform\.current_issuer\(\)/);
  assert.match(migration, /active_organization_setup_access_for_subject/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.active_organization_setup_access_for_subject/);
});

test('pre-activation users receive a dedicated setup workspace instead of normal business access', () => {
  assert.match(setupLanding, /Organization Setup/);
  assert.match(setupLanding, /Business-runtime access remains locked/);
  assert.match(setupWorkspace, /Final activation remains controlled by an authorized active ancestor/);
  assert.match(setupWorkspace, /Assign operating entity/);
  assert.match(setupWorkspace, /Primary administrator/);
  assert.match(setupWorkspace, /No tenant administration role is automatically granted/);
  assert.match(setupWorkspace, /This gate is derived from authoritative enterprise state/);
  assert.doesNotMatch(setupWorkspace, /activateOrganizationSetup/);
  assert.match(organizationsPage, /Descendant onboarding portfolio/);
  assert.match(organizationsPage, /ReadinessPortfolio/);
});

test('activation handoff targets an explicitly designated setup owner', () => {
  assert.match(migration, /primary_administrator_subject_id text/);
  assert.match(migration, /primary_administrator_issuer text/);
  assert.match(runtime, /plan\.primaryAdministratorSubjectId/);
  assert.match(runtime, /plan\.primaryAdministratorIssuer/);
  assert.match(runtime, /tenant\.membership\.handed_off_from_setup/);
  assert.match(runtime, /authorizationRolesGranted: \[\]/);
});
