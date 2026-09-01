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

test("request-time admin grant is not open by default", () => {
  const prevList = process.env.PLATFORM_ADMIN_SUBJECTS;
  const prevBootstrap = process.env.CLERK_ADMIN_USER_ID;
  try {
    process.env.PLATFORM_ADMIN_SUBJECTS = "user_allowed,user_other";
    process.env.CLERK_ADMIN_USER_ID = "user_bootstrap";
    assert.equal(shouldGrantPlatformAdmin("user_allowed"), true);
    assert.equal(shouldGrantPlatformAdmin("user_bootstrap"), true);
    assert.equal(shouldGrantPlatformAdmin("user_random"), false);
  } finally {
    if (prevList === undefined) delete process.env.PLATFORM_ADMIN_SUBJECTS; else process.env.PLATFORM_ADMIN_SUBJECTS = prevList;
    if (prevBootstrap === undefined) delete process.env.CLERK_ADMIN_USER_ID; else process.env.CLERK_ADMIN_USER_ID = prevBootstrap;
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


test("Platform membership discovery never auto-provisions access", () => {
  const iam = read("../lib/iam-adapter.ts");
  const workspaces = read("../app/api/workspaces/route.ts");
  assert.doesNotMatch(iam, /AutoProvisioningMembershipRepository|INSERT INTO platform\.memberships/);
  assert.doesNotMatch(workspaces, /Auto-provisioning user|INSERT INTO platform\.memberships/);
});

test("Clerk webhooks are public to Clerk auth but signature verified in route", () => {
  const proxy = read("../proxy.ts");
  const webhook = read("../app/api/webhooks/clerk/route.ts");
  assert.match(proxy, /\/api\/webhooks/);
  assert.match(webhook, /verifyWebhook/);
});
