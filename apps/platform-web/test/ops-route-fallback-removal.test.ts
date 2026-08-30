import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);

const uiRoutes = [
  "apps/platform-web/app/api/activity/route.ts",
  "apps/platform-web/app/api/usage/summary/route.ts",
  "apps/platform-web/app/api/workflows/blueprints/route.ts",
  "apps/platform-web/app/api/workflows/instances/route.ts",
  "apps/platform-web/app/api/data/pipelines/route.ts",
  "apps/platform-web/app/api/context-engine/route.ts",
];

const inboundWebhookRoutes = [
  "apps/platform-web/app/api/webhooks/twilio/route.ts",
];

function read(path: string): string {
  return readFileSync(join(repoRoot.pathname, path), "utf8");
}

test("ops UI routes use shared fail-closed context and contain no demo fallbacks", () => {
  for (const path of uiRoutes) {
    const source = read(path);
    assert.match(source, /resolveRequestContext\(request\)/u, `${path} must use shared request context`);
    assert.doesNotMatch(source, /authenticateAndResolveContext/u, `${path} must not call IAM with route-local demo context`);
    assert.doesNotMatch(source, /00000000-0000-0000-0000-000000000001/u, `${path} must not contain demo tenant`);
    assert.doesNotMatch(source, /00000000-0000-0000-0000-000000000002/u, `${path} must not contain demo organization`);
    assert.doesNotMatch(source, /fallback if empty|dummy data|pipe-00|wf_live_|activity_live_/iu, `${path} must not emit simulated production data`);
  }
});

test("Twilio webhook fails closed on missing context", () => {
  for (const path of inboundWebhookRoutes) {
    const source = read(path);
    assert.match(source, /TENANT_ID_REQUIRED/u, `${path} must reject missing tenantId`);
    assert.match(source, /CONNECTOR_KEY_REQUIRED/u, `${path} must reject missing connectorKey`);
    assert.match(source, /uuidPattern\.test\(tenantId\)/u, `${path} must validate tenantId shape`);
    assert.doesNotMatch(source, /00000000-0000-0000-0000-000000000001/u, `${path} must not contain demo tenant`);
    assert.doesNotMatch(source, /default-twilio|default-resend/u, `${path} must not contain default provider connector fallback`);
  }
});
