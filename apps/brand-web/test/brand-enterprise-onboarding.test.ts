import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand Enterprise Hub launches governed onboarding instead of remaining read-only', () => {
  const hub = read('../app/(workspace)/enterprise/page.tsx');
  assert.match(hub, /href="\/enterprise\/onboard"/);
  assert.match(hub, /Onboard organization/);
  assert.match(hub, /Continue setup/);
});

test('organization onboarding reuses governed change requests with four-eyes approval', () => {
  const request = read('../app/api/enterprise/onboarding/requests/route.ts');
  const approve = read('../app/api/enterprise/onboarding/requests/[id]/approve/route.ts');
  assert.match(request, /requestChildOrganization/);
  assert.match(request, /hasBrandGovernanceForOrganization/);
  assert.match(request, /Idempotency-Key header is required/);
  assert.match(approve, /approveCreateOrganizationRequest/);
  assert.match(approve, /allowSelfApproval: false/);
  assert.match(approve, /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/);
});

test('approved organizations continue into the existing persisted setup runtime', () => {
  const plan = read('../app/api/enterprise/onboarding/plans/[planId]/route.ts');
  const actions = read('../app/api/enterprise/onboarding/plans/[planId]/actions/route.ts');
  const data = read('../lib/enterprise-onboarding.ts');
  assert.match(data, /platform\.organization_setup_plans/);
  assert.match(data, /platform\.organization_closure/);
  assert.match(data, /closure\.depth > 0/);
  assert.match(plan, /loadBrandSetupPlan/);
  assert.match(actions, /addOrganizationSetupParticipant/);
  assert.match(actions, /designateOrganizationSetupPrimaryAdministrator/);
  assert.match(actions, /assignOrganizationOperatingEntity/);
  assert.match(actions, /changeOrganizationSetupRequirement/);
});

test('legal entity onboarding enforces Search Before Create and independent verification', () => {
  const runtime = read('../../../packages/postgres-runtime/src/enterprise-legal.ts');
  const legal = read('../app/api/enterprise/onboarding/legal-entities/route.ts');
  const verify = read('../app/api/enterprise/onboarding/legal-entities/[id]/verify/route.ts');
  assert.match(runtime, /searchEnterpriseLegalEntities/);
  assert.match(runtime, /normalized_identifier/);
  assert.match(runtime, /ENTERPRISE_LEGAL_ENTITY_ALREADY_EXISTS/);
  assert.match(runtime, /'VERIFICATION_PENDING'/);
  assert.match(runtime, /ENTERPRISE_LEGAL_ENTITY_SEPARATION_OF_DUTIES_REQUIRED/);
  assert.match(runtime, /enterprise\.legal_entity\.verification_requested/);
  assert.match(runtime, /enterprise\.legal_entity\.verified/);
  assert.match(legal, /createEnterpriseLegalEntityIntake/);
  assert.match(verify, /verifyEnterpriseLegalEntity/);
});

test('Brand onboarding UI exposes actual setup controls', () => {
  const landing = read('../components/BrandEnterpriseOnboarding.tsx');
  const workspace = read('../components/BrandEnterpriseSetupWorkspace.tsx');
  assert.match(landing, /Submit onboarding request/);
  assert.match(landing, /Four-eyes required/);
  assert.match(landing, /Continue setup/);
  assert.match(workspace, /Setup participants &amp; primary administrator/);
  assert.match(workspace, /Search Before Create/);
  assert.match(workspace, /Submit for verification/);
  assert.match(workspace, /Bind verified legal operator/);
  assert.match(workspace, /Requirements/);
  assert.match(workspace, /Ready for parent activation/);
});
