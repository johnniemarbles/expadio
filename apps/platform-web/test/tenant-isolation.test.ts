import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveEffectiveContext } from "@expadio/tenancy";
import { shouldGrantPlatformAdmin } from "../lib/admin-grant.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const TENANT_A = "00000000-0000-0000-0000-0000000000a1";
const ORG_A = "00000000-0000-0000-0000-0000000000a2";
const TENANT_B = "00000000-0000-0000-0000-0000000000b1";
const ORG_B = "00000000-0000-0000-0000-0000000000b2";

const identity = { subjectId: "user_1", actorKind: "user" as const, issuer: "https://clerk.expadio.com" };

test("a member resolves their own tenant", () => {
  const ctx = resolveEffectiveContext({
    identity,
    tenantId: TENANT_A,
    organizationId: ORG_A,
    memberships: [{ tenantId: TENANT_A, organizationId: ORG_A }],
  });
  assert.equal(ctx.tenantId, TENANT_A);
});

test("a forged (tenant, org) the caller is not a member of is denied", () => {
  assert.throws(
    () =>
      resolveEffectiveContext({
        identity,
        tenantId: TENANT_B, // not in memberships
        organizationId: ORG_B,
        memberships: [{ tenantId: TENANT_A, organizationId: ORG_A }],
      }),
    /NO_MEMBERSHIP/,
  );
});

test("membership in a tenant does not grant a different org in it", () => {
  assert.throws(
    () =>
      resolveEffectiveContext({
        identity,
        tenantId: TENANT_A,
        organizationId: ORG_B, // wrong org for tenant A
        memberships: [{ tenantId: TENANT_A, organizationId: ORG_A }],
      }),
    /NO_MEMBERSHIP/,
  );
});

test("platform-admin grant is gated by allowlist and demo switch", () => {
  const prevOpen = process.env.DEMO_OPEN_ADMIN;
  const prevList = process.env.PLATFORM_ADMIN_SUBJECTS;
  try {
    process.env.DEMO_OPEN_ADMIN = "false";
    process.env.PLATFORM_ADMIN_SUBJECTS = "user_allowed, user_other";
    assert.equal(shouldGrantPlatformAdmin("user_allowed"), true);
    assert.equal(shouldGrantPlatformAdmin("user_random"), false);
    process.env.DEMO_OPEN_ADMIN = "true";
    assert.equal(shouldGrantPlatformAdmin("user_random"), true);
  } finally {
    if (prevOpen === undefined) delete process.env.DEMO_OPEN_ADMIN; else process.env.DEMO_OPEN_ADMIN = prevOpen;
    if (prevList === undefined) delete process.env.PLATFORM_ADMIN_SUBJECTS; else process.env.PLATFORM_ADMIN_SUBJECTS = prevList;
  }
});

test("bootstrap routes no longer hardcode the demo tenant", () => {
  const context = read("../app/api/context/route.ts");
  const overview = read("../app/api/overview/route.ts");
  assert.match(context, /listActiveMemberships/);
  assert.doesNotMatch(context, /tenantId: '00000000-0000-0000-0000-000000000001'/);
  assert.match(overview, /resolveRequestContext\(request\)/);
  assert.doesNotMatch(overview, /authenticateAndResolveContext/);
});

test("the provider list response type exposes a fingerprint, never a secret", () => {
  const providers = read("../app/api/communications/providers/route.ts");
  const iface = providers.match(/export interface ConnectorListItem \{([\s\S]*?)\n\}/);
  assert.ok(iface, "ConnectorListItem interface should be present");
  const body = iface![1];
  // The response carries an HMAC-derived fingerprint, and no field that is a secret.
  assert.match(body, /fingerprint: string \| null/);
  assert.doesNotMatch(body, /secret|credentialRef|token|password/i);
  // And registration only accepts an external secret reference, never a raw secret.
  assert.match(providers, /credentialRef must be an external secret reference/);
});
