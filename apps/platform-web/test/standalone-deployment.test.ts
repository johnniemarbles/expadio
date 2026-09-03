import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('Platform starts Next standalone output after migrations and bootstrap seed',()=>{
  const pkg=JSON.parse(read('../package.json'));
  assert.match(pkg.scripts.start,/scripts\/migrate\.mjs/);
  assert.match(pkg.scripts.start,/scripts\/seed\.cjs/);
  assert.match(pkg.scripts.start,/scripts\/verify-runtime-schema\.mjs/);
  assert.match(pkg.scripts.start,/scripts\/start-standalone\.mjs/);
  assert.ok(
    pkg.scripts.start.indexOf('verify-runtime-schema.mjs') <
      pkg.scripts.start.indexOf('start-standalone.mjs'),
  );
  assert.doesNotMatch(pkg.scripts.start,/next start/);
});

test('standalone launcher copies static assets and binds Railway-compatible hostname',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/\.next', 'standalone'/);
  assert.match(launcher,/sourceStatic/);
  assert.match(launcher,/cp\(sourceStatic, targetStatic/);
  assert.match(launcher,/HOSTNAME: '0\.0\.0\.0'/);
  assert.doesNotMatch(launcher,/HOSTNAME: process\.env\.HOSTNAME/);
});

test('Platform launcher supports Next monorepo standalone layout',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/join\(standaloneRoot, 'apps', appName, 'server\.js'\)/);
  assert.match(launcher,/const runtimeRoot = dirname\(serverPath\)/);
  assert.match(launcher,/const targetStatic = join\(runtimeRoot, '\.next', 'static'\)/);
});

test('Platform never inherits the container hostname for the listening socket',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/Binding Next\.js to 0\.0\.0\.0/);
  assert.match(launcher,/HOSTNAME: '0\.0\.0\.0'/);
  assert.doesNotMatch(launcher,/process\.env\.HOSTNAME \|\|/);
});


test('Platform runtime schema preflight proves audit/outbox RLS writes before serving traffic',()=>{
  const verifier=read('../scripts/verify-runtime-schema.mjs');
  assert.match(verifier,/platform\.domain_events/);
  assert.match(verifier,/platform\.domain_event_outbox/);
  assert.match(verifier,/set_config\(\$1, \$2, true\)/);
  assert.match(verifier,/Runtime audit\/outbox schema preflight passed/);
  assert.match(verifier,/ROLLBACK/);
});

test('migration runner refuses broad legacy backfill from an early sentinel',()=>{
  const migrate=read('../scripts/migrate.mjs');
  assert.match(migrate,/platform\.execution_artifacts/);
  assert.match(migrate,/SCHEMA_MIGRATION_HISTORY_INCOMPLETE/);
  assert.doesNotMatch(migrate,/capCount && capCount > 0/);
});


test('Platform Railway config owns build, start, and healthcheck contract',()=>{
  const railway=JSON.parse(read('../railway.json'));
  assert.equal(railway.build.builder,'RAILPACK');
  assert.equal(railway.build.buildCommand,'pnpm --filter @expadio/platform-web build');
  assert.equal(railway.deploy.startCommand,'pnpm --filter @expadio/platform-web start');
  assert.equal(railway.deploy.healthcheckPath,'/api/health');
  assert.equal(railway.deploy.restartPolicyType,'ON_FAILURE');
});

test('Platform health endpoint is dependency-free and unauthenticated',()=>{
  const health=read('../app/api/health/route.ts');
  assert.match(health,/ok: true/);
  assert.match(health,/service: 'platform-web'/);
  assert.doesNotMatch(health,/resolveRequestContext|auth\(|dbPool|DATABASE_URL/);

  const proxy=read('../proxy.ts');
  assert.match(proxy,/['"]\/api\/health\(\.\*\)['"]/);
  assert.ok(
    proxy.indexOf('/api/health(.*)') < proxy.indexOf('if (!isPublicRoute(req))'),
    'health route must be public before Clerk protection is applied',
  );
});
