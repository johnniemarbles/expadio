import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guardedRoutes = [
  "../app/api/organizations/route.ts",
  "../app/api/organizations/list/route.ts",
  "../app/api/capabilities/route.ts",
  "../app/api/governance/authorization/route.ts",
  "../app/api/governance/reviews/route.ts",
  "../app/api/configuration/route.ts",
  "../app/api/configuration/credentials/route.ts",
];

const forbidden = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "authenticateAndResolveContext",
  "Auto-provisioning",
  "fallback to dummy data",
];

test("platform-control routes use shared fail-closed context instead of demo fallbacks", () => {
  for (const route of guardedRoutes) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");

    assert.match(source, /resolveRequestContext\(request\)/, `${route} must resolve the active workspace explicitly`);
    assert.match(source, /deniedResponse\(/, `${route} must preserve fail-closed denied responses`);

    for (const value of forbidden) {
      assert.equal(source.includes(value), false, `${route} must not contain ${value}`);
    }
  }
});
