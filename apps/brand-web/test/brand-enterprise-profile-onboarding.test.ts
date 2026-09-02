import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('enterprise profile onboarding extends bootstrap persistence without creating a second tenant boundary', () => {
  const migration = read('../../../infra/db/migrations/0113_enterprise_profile_onboarding.sql');
  assert.match(migration, /ALTER TABLE platform\.enterprise_profiles/);
  assert.match(migration, /configuration_state/);
  assert.match(migration, /root_organization_id/);
  assert.match(migration, /enterprise_profiles_root_same_enterprise_fk/);
  assert.match(migration, /CONFIGURE_ENTERPRISE_PROFILE/);
  assert.doesNotMatch(migration, /CREATE TABLE platform\.tenants/);
});

test('configured enterprise profiles require root authority and accountable configuration metadata', () => {
  const migration = read('../../../infra/db/migrations/0113_enterprise_profile_onboarding.sql');
  assert.match(migration, /configuration_state = 'CONFIGURED'/);
  assert.match(migration, /root_organization_id IS NOT NULL/);
  assert.match(migration, /configured_at IS NOT NULL/);
  assert.match(migration, /configured_by_subject_id IS NOT NULL/);
});

test('profile runtime enforces idempotency, root scope, and separation of duties', () => {
  const runtime = read('../../../packages/postgres-runtime/src/enterprise-profile.ts');
  assert.match(runtime, /requestEnterpriseProfileConfiguration/);
  assert.match(runtime, /approveEnterpriseProfileConfiguration/);
  assert.match(runtime, /parent_organization_id IS NULL/);
  assert.match(runtime, /ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(runtime, /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/);
  assert.match(runtime, /enterprise\.profile\.configuration_requested/);
  assert.match(runtime, /enterprise\.profile\.configured/);
});

test('Brand profile onboarding exposes bootstrap/configured state and four-eyes approval', () => {
  const component = read('../components/BrandEnterpriseProfileOnboarding.tsx');
  const route = read('../app/api/enterprise/onboarding/profile/route.ts');
  const approval = read('../app/api/enterprise/onboarding/profile/requests/[id]/approve/route.ts');

  assert.match(component, /Onboard enterprise/);
  assert.match(component, /Operating mode/);
  assert.match(component, /Root authority/);
  assert.match(component, /Different approver required/);
  assert.match(route, /requestEnterpriseProfileConfiguration/);
  assert.match(route, /hasBrandGovernanceForOrganization/);
  assert.match(approval, /approveEnterpriseProfileConfiguration/);
});

test('Enterprise Hub surfaces profile onboarding before organization expansion', () => {
  const hub = read('../app/(workspace)/enterprise/page.tsx');
  const onboarding = read('../components/BrandEnterpriseOnboarding.tsx');
  assert.match(hub, /enterpriseConfigurationState/);
  assert.match(hub, /\/enterprise\/onboard\/profile/);
  assert.match(hub, /Enterprise profile onboarding is incomplete/);
  assert.match(onboarding, /Enterprise profile/);
});
