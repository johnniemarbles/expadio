import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand module launcher activates any activatable module through the generic endpoint', () => {
  const launcher = read('../components/ModuleLauncher.tsx');

  assert.match(launcher, /ACTIVATABLE\.has\(availability\)/);
  assert.doesNotMatch(launcher, /ACTIVATABLE\.has\(availability\) && moduleKey === 'learning'/);
  assert.match(launcher, /\/api\/modules\/\$\{encodeURIComponent\(moduleKey\)\}\/activate/);
  assert.match(launcher, /`Activate \$\{displayName\}`/);
});

test('Brand generic activation endpoint provisions Learning and Lead Management only after admin authorization', () => {
  const route = read('../app/api/modules/[key]/activate/route.ts');
  const brandContext = read('../lib/brand-context.ts');

  assert.match(route, /hasBrandAdministrationRole/);
  assert.match(route, /SUPPORTED_MODULES = new Set\(\['learning', 'lead-management'\]\)/);
  assert.match(route, /activateLearningModule/);
  assert.match(route, /activateSimpleProductModule/);
  assert.match(route, /moduleKey: 'lead-management'/);
  assert.match(route, /MODULE_PROVISIONER_NOT_IMPLEMENTED/);
  assert.match(route, /MODULE_LOCKED_BY_PLAN/);
  assert.match(brandContext, /a\.valid_from<=now\(\)/);
});

test('Lead Management manifest exposes a launch route for active Brand navigation', () => {
  const originalMigration = read('../../../infra/db/migrations/0124_brand_lead_management_module.sql');
  const backfillMigration = read('../../../infra/db/migrations/0135_brand_lead_management_launch_route.sql');

  assert.match(originalMigration, /'route', '\/leads'/);
  assert.match(backfillMigration, /module_key = 'lead-management'/);
  assert.match(backfillMigration, /'\{route\}'/);
  assert.match(backfillMigration, /'"\/leads"'::jsonb/);
});
