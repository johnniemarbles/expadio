import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);

function readRoute(path: string): string {
  return readFileSync(join(repoRoot.pathname, path), "utf8");
}

const webhookRoutes = [
  {
    path: "apps/platform-web/app/api/webhooks/resend/route.ts",
    provider: "Resend",
    signatureHelper: "ResendWebhookNormalizer",
    secretResolver: "resolveSecret",
    invalidSignatureStatus: "WEBHOOK_SIGNATURE_INVALID",
    invalidTenantError: "WEBHOOK_TENANT_INVALID",
    missingTenantError: "WEBHOOK_TENANT_REQUIRED",
    missingConnectorError: "WEBHOOK_CONNECTOR_REQUIRED",
  },
  {
    path: "apps/platform-web/app/api/webhooks/twilio/route.ts",
    provider: "Twilio",
    signatureHelper: "TwilioWebhookNormalizer",
    secretResolver: "resolveAuthToken",
    invalidSignatureStatus: "WEBHOOK_SIGNATURE_INVALID",
    invalidTenantError: "TENANT_ID_REQUIRED",
    missingTenantError: "TENANT_ID_REQUIRED",
    missingConnectorError: "CONNECTOR_KEY_REQUIRED",
  },
];

test("provider webhook ingress remains tenant-explicit and signature checked", () => {
  for (const route of webhookRoutes) {
    const content = readRoute(route.path);

    assert.match(content, /export\s+async\s+function\s+POST\s*\(/u, `${route.provider} webhook must expose POST ingress`);
    assert.match(content, /await\s+req\.arrayBuffer\s*\(/u, `${route.provider} webhook must verify the exact raw body`);
    assert.match(content, new RegExp(route.signatureHelper, "u"), `${route.provider} webhook must use its provider normalizer`);
    assert.match(content, new RegExp(route.secretResolver, "u"), `${route.provider} webhook must resolve provider signing material`);
    assert.match(content, /ingestCommunicationProviderWebhook\s*\(/u, `${route.provider} webhook must use the shared ingestion runtime`);
    assert.match(content, /searchParams\.get\(['"]tenantId['"]\)/u, `${route.provider} webhook must require explicit tenantId`);
    assert.match(content, /searchParams\.get\(['"]connectorKey['"]\)/u, `${route.provider} webhook must require explicit connectorKey`);
    assert.match(content, new RegExp(route.invalidTenantError, "u"), `${route.provider} webhook must reject invalid tenantId`);
    assert.match(content, new RegExp(route.missingTenantError, "u"), `${route.provider} webhook must reject missing tenantId`);
    assert.match(content, new RegExp(route.missingConnectorError, "u"), `${route.provider} webhook must reject missing connectorKey`);
    assert.match(content, new RegExp(route.invalidSignatureStatus, "u"), `${route.provider} webhook must surface invalid signatures`);
    assert.doesNotMatch(content, /resolveRequestContext\s*\(/u, `${route.provider} webhook must not use browser/session context for provider ingress`);
    assert.doesNotMatch(content, /withTenantClient\s*\(/u, `${route.provider} webhook must delegate persistence to the shared ingestion runtime`);
  }
});
