import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);

const routeFiles = [
  "apps/platform-web/app/api/agent/runs/route.ts",
  "apps/platform-web/app/api/agents/bindings/route.ts",
  "apps/platform-web/app/api/brain/route.ts",
  "apps/platform-web/app/api/brain/corrections/route.ts",
  "apps/platform-web/app/api/brain/history/route.ts",
  "apps/platform-web/app/api/brain/provenance/route.ts",
  "apps/platform-web/app/api/brain/slices/route.ts",
  "apps/platform-web/app/api/brain/sources/route.ts",
];

const forbidden = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "authenticateAndResolveContext",
  "identityVerifier",
  "membershipRepository",
  "run_live_",
  "corr_live_",
  "pub_live_",
  "prov_live_",
  "slice_live_",
  "src_live_",
  "Live Core Brain Database",
  "Live DB Connected",
];

test("brain and agent routes use shared context and no demo data", () => {
  for (const route of routeFiles) {
    const content = readFileSync(join(repoRoot.pathname, route), "utf8");
    assert.match(content, /resolveRequestContext\(request\)/u, `${route} must resolve shared request context`);
    assert.match(content, /deniedResponse/u, `${route} must preserve fail-closed denial mapping`);
    for (const token of forbidden) {
      assert.equal(content.includes(token), false, `${route} must not contain ${token}`);
    }
  }
});
