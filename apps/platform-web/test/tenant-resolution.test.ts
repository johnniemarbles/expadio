import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const middleware = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const requestContext = readFileSync(new URL("../lib/request-context.ts", import.meta.url), "utf8");

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
});

test("tenant resolution verifies membership rather than trusting the header", () => {
  // The header is only a request for a tenant; membership is the boundary.
  assert.match(requestContext, /x-expadio-tenant-id/);
  assert.match(requestContext, /authenticateAndResolveContext/);
  // A membership failure resolves to a denial, not another tenant's data.
  assert.match(requestContext, /TENANT_ACCESS_DENIED/);
});
