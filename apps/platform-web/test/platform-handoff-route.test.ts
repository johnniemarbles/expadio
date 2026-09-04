import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Platform-web handoff route revalidates context and sets workspace cookies before redirecting', () => {
  const route = read('../app/handoff/route.ts');
  assert.match(route, /resolveRequestContext/);
  assert.match(route, /TENANT_ACCESS_DENIED/);
  assert.match(route, /safeReturnTo/);
  assert.match(route, /response\.cookies\.set\('expadio-tenant'/);
  assert.match(route, /NextResponse\.redirect\(redirectUrl, 303\)/);
});

test('Platform-web handoff route catches ContextDenied errors and returns JSON response', () => {
  const route = read('../app/handoff/route.ts');
  assert.match(route, /deniedResponse\(error\)/);
  assert.match(route, /NextResponse\.json\(body, \{ status \}\)/);
});

test('Platform-web handoff route accepts both tenant/account and org/organization search parameters', () => {
  const route = read('../app/handoff/route.ts');
  assert.match(route, /url\.searchParams\.get\('tenant'\)\s*\?\?\s*url\.searchParams\.get\('account'\)/);
  assert.match(route, /url\.searchParams\.get\('org'\)\s*\?\?\s*url\.searchParams\.get\('organization'\)/);
});
