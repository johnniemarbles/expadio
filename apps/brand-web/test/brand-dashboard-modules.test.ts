import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand home is a module dashboard rather than a Learning redirect', () => {
  const page = read('../app/(workspace)/page.tsx');
  assert.match(page, /listTenantProductModules/);
  assert.match(page, /<h1>Apps<\/h1>/);
  assert.doesNotMatch(page, /redirect\('\/learning'\)/);
  assert.doesNotMatch(page, /tenant_module_entitlements.*INSERT|INSERT.*tenant_module_entitlements/s);
});

test('Platform-to-Brand handoff revalidates membership before changing workspace cookies', () => {
  const handoff = read('../app/handoff/route.ts');
  assert.match(handoff, /resolveBrandContext/);
  assert.match(handoff, /context\.workspaces\.some/);
  assert.match(handoff, /BRAND_WORKSPACE_ACCESS_DENIED/);
  assert.match(handoff, /response\.cookies\.set/);
});
