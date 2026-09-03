import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../infra/db/migrations/0138_content_assets.sql', import.meta.url),
  'utf8',
);
const runtime = readFileSync(
  new URL('../../../packages/postgres-runtime/src/content-assets.ts', import.meta.url),
  'utf8',
);

test('content assets are tenant and organization scoped under forced RLS', () => {
  for (const table of ['content_assets', 'content_asset_references', 'content_asset_events']) {
    assert.match(migration, new RegExp(`ALTER TABLE platform\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /current_context_can_access_organization\(tenant_id, organization_id\)/);
  assert.match(migration, /content_asset_references_asset_scope_fk/);
});

test('content asset identity and lifecycle evidence are database-enforced', () => {
  assert.match(migration, /CONTENT_ASSET_IMMUTABLE_IDENTITY/);
  assert.match(migration, /CONTENT_ASSET_INVALID_STATE_TRANSITION/);
  assert.match(migration, /CONTENT_ASSET_EVENTS_APPEND_ONLY/);
  assert.match(migration, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(runtime, /FOR UPDATE/);
  assert.match(runtime, /CONTENT_ASSET_IDEMPOTENCY_CONFLICT/);
  assert.match(runtime, /INSERT INTO platform\.content_asset_events/);
});

test('storage references stay opaque and provider-neutral', () => {
  assert.match(migration, /never a public URL or provider credential/);
  assert.doesNotMatch(migration, /public_url|access_key|secret_key|service_role/i);
  assert.doesNotMatch(runtime, /SUPABASE|S3_|AWS_|bucket/i);
});


test('content asset migration requires quarantine and valid PL/pgSQL quoting', () => {
  assert.doesNotMatch(migration, /LANGUAGE plpgsql\nAS \$\n/);
  assert.match(
    migration,
    /WHEN 'UPLOADED' THEN NEW\.state IN \('QUARANTINED', 'REJECTED', 'DELETED'\)/,
  );
  assert.doesNotMatch(
    migration,
    /WHEN 'UPLOADED' THEN NEW\.state IN \([^\n]*'AVAILABLE'/,
  );
});
