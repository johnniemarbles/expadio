import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const webhookRoot = "apps/platform-web/app/api/webhooks";
const textExtensions = new Set([".ts", ".tsx"]);

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

test("provider webhook routes stay isolated from browser session route patterns", () => {
  const files = walk(join(repoRoot.pathname, webhookRoot)).filter((file) => textExtensions.has(extname(file)));
  const routeFiles = files.filter((file) => file.endsWith("route.ts") || file.endsWith("route.tsx"));

  assert.ok(routeFiles.length > 0, "expected at least one provider webhook route");

  for (const file of routeFiles) {
    const rel = relative(repoRoot.pathname, file);
    const content = readFileSync(file, "utf8");

    assert.match(content, /export\s+async\s+function\s+POST\s*\(/u, `${rel} must expose provider ingress as POST`);
    assert.match(content, /await\s+req\.arrayBuffer\s*\(/u, `${rel} must read the raw webhook body`);
    assert.match(content, /searchParams\.get\(['"]tenantId['"]\)/u, `${rel} must require explicit tenant context`);
    assert.match(content, /searchParams\.get\(['"]connectorKey['"]\)/u, `${rel} must require explicit connector context`);
    assert.match(content, /ingestCommunicationProviderWebhook\s*\(/u, `${rel} must delegate persistence to the communication ingestion runtime`);

    assert.doesNotMatch(content, /resolveRequestContext\s*\(/u, `${rel} must not use browser/session request context`);
    assert.doesNotMatch(content, /withTenantClient\s*\(/u, `${rel} must not bypass provider ingestion persistence`);
    assert.doesNotMatch(content, /\bauth\s*\(/u, `${rel} must not depend on interactive user auth`);
    assert.doesNotMatch(content, /\bheaders\s*\(/u, `${rel} must not depend on framework request headers outside the provider request`);
    assert.doesNotMatch(content, /\bcookies\s*\(/u, `${rel} must not depend on browser cookies`);
    assert.doesNotMatch(content, /\bdbPool\.(query|connect)\s*\(/u, `${rel} must not perform direct persistence outside the ingestion runtime`);
  }
});
