import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const demoTenant = "00000000-0000-0000-0000-000000000001";
const demoOrganization = "00000000-0000-0000-0000-000000000002";

const routeFiles = [
  "../app/api/context/route.ts",
  "../app/api/sessions/route.ts",
  "../app/api/workspaces/route.ts",
  "../app/api/overview/route.ts",
];

test("core request routes resolve explicit workspace context instead of demo tenant fallbacks", () => {
  for (const path of routeFiles) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /resolveRequestContext/);
    assert.doesNotMatch(source, new RegExp(demoTenant));
    assert.doesNotMatch(source, new RegExp(demoOrganization));
    assert.doesNotMatch(source, /Auto-provisioning user/i);
    assert.doesNotMatch(source, /platform\.memberships[\s\S]*INSERT/i);
  }
});
