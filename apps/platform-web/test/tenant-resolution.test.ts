import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const middleware = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const requestContext = readFileSync(new URL("../lib/request-context.ts", import.meta.url), "utf8");
const liveAdapter = readFileSync(new URL("../lib/live-adapter.ts", import.meta.url), "utf8");

test("middleware propagates the shell's workspace selection into tenant headers", () => {
  // The active workspace arrives as ?account=<tenantId>&org=<organizationId>.
  assert.match(middleware, /searchParams/);
  assert.match(middleware, /get\('account'\)/);
  assert.match(middleware, /get\('org'\)/);
  // …and is injected as the headers resolveRequestContext reads.
  assert.match(middleware, /x-expadio-tenant-id/);
  assert.match(middleware, /x-expadio-organization-id/);
  // Modified request headers are forwarded to the route handler.
  assert.match(middleware, /NextResponse\.next\(\{\s*request:\s*\{\s*headers/s);
});

test("middleware only trusts well-formed UUID selections", () => {
  assert.match(middleware, /UUID\s*=\s*\/\^\[0-9a-f\]/i);
  // The raw param is validated before it is trusted as a header or a cookie.
  assert.match(middleware, /UUID\.test\(/);
});

test("middleware persists the selection so deep links keep the same workspace", () => {
  assert.match(middleware, /cookies\.set\(TENANT_COOKIE/);
  assert.match(middleware, /cookies\.set\(ORG_COOKIE/);
  // Cookie is read back as a fallback when the query string is absent.
  assert.match(middleware, /cookies\.get\(TENANT_COOKIE\)/);
  assert.match(middleware, /x-expadio-tenant-source/);
  assert.match(middleware, /x-expadio-organization-source/);
  assert.match(middleware, /requestHeaders\.delete\(name\)/);
});

test("stale persisted workspace preferences recover without weakening explicit selection", () => {
  assert.match(requestContext, /organizationSelectionSource === 'query'/);
  assert.match(requestContext, /tenantSelectionSource === 'query'/);
  assert.match(requestContext, /tenantMemberships\.length === 0/);
  assert.match(requestContext, /\?\? memberships\[0\]/);
  assert.match(requestContext, /TENANT_ACCESS_DENIED/);
});

test("tenant resolution verifies membership rather than trusting the header", () => {
  // The header is only a request for a tenant; membership is the boundary.
  assert.match(requestContext, /x-expadio-tenant-id/);
  assert.match(requestContext, /authenticateAndResolveContext/);
  // A membership failure resolves to a denial, not another tenant's data.
  assert.match(requestContext, /TENANT_ACCESS_DENIED/);
});

test("SSR API subrequests only preserve originally explicit workspace selectors", () => {
  assert.match(liveAdapter, /tenantSource === 'query'/);
  assert.match(liveAdapter, /organizationSource === 'query'/);
  assert.match(liveAdapter, /searchParams\.set\('account', tenantId\)/);
  assert.match(liveAdapter, /searchParams\.set\('org', organizationId\)/);
  assert.doesNotMatch(
    liveAdapter,
    /forwarded\.set\('x-expadio-tenant-id'|forwarded\.set\('x-expadio-organization-id'/,
  );
});

test("cookie recovery prefers the persisted tenant before an org-only fallback", () => {
  const tenantFallback = requestContext.indexOf("membership.tenantId === requestedTenant");
  const organizationOnlyFallback = requestContext.lastIndexOf(
    "membership.organizationId === requestedOrganization",
  );
  assert.ok(tenantFallback >= 0);
  assert.ok(organizationOnlyFallback >= 0);
  assert.ok(tenantFallback < organizationOnlyFallback);
});

test("cookie-derived SSR workspace headers remain recoverable instead of becoming explicit selectors", () => {
  assert.match(liveAdapter, /tenantSource = incoming\.get\('x-expadio-tenant-source'\)/);
  assert.match(liveAdapter, /organizationSource = incoming\.get\('x-expadio-organization-source'\)/);
  assert.match(
    liveAdapter,
    /tenantId[\s\S]*tenantSource === 'query'[\s\S]*searchParams\.set\('account', tenantId\)/,
  );
  assert.match(
    liveAdapter,
    /organizationId[\s\S]*organizationSource === 'query'[\s\S]*searchParams\.set\('org', organizationId\)/,
  );
});
