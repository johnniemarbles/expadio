import assert from 'node:assert/strict';
import test from 'node:test';

const routePath = '../app/api/communications/templates/[key]/clone/route.ts';

test('brand template clone route has the required authorization and error guards', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL(routePath, import.meta.url), 'utf8'),
  );

  assert.match(source, /status: 401/);
  assert.match(source, /reasonKey: 'FORBIDDEN'/);
  assert.match(source, /status: 403/);
  assert.match(source, /status: 404/);
  assert.match(source, /status: 409/);
  assert.match(source, /BRAND_TEMPLATE_ROLES/);
});

test('brand template clone route preserves source lineage and creates a draft', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL(routePath, import.meta.url), 'utf8'),
  );

  assert.match(source, /cloned_source_template_id/);
  assert.match(source, /cloned_source_version/);
  assert.match(source, /platform_update_available/);
  assert.match(source, /'DRAFT'/);
  assert.match(source, /sourceRow\.template_id/);
  assert.match(source, /sourceRow\.version/);
});

test('brand template clone route serializes concurrent clones and maps duplicate races to 409', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL(routePath, import.meta.url), 'utf8'),
  );

  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /23505/);
  assert.match(source, /DUPLICATE_TEMPLATE_CONSTRAINT/);
});

test('brand template clone route sets tenant RLS context before database access', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL(routePath, import.meta.url), 'utf8'),
  );

  assert.match(source, /set_config\('app\.tenant_id'/);
  assert.match(source, /context\.tenantId/);
});
