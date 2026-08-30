import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const apiRoot = join(repoRoot.pathname, "apps/platform-web/app/api");

const contextMarkers = [
  "resolveRequestContext(",
  "withTenantClient(",
  "requireStepUp(",
  "ingestCommunicationProviderWebhook(",
];

const publicOrProviderExceptions = new Set([
  "apps/platform-web/app/api/webhooks/resend/route.ts",
  "apps/platform-web/app/api/webhooks/twilio/route.ts",
]);

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function isRouteFile(path: string): boolean {
  return path.endsWith("/route.ts") || path.endsWith("/route.tsx");
}

test("production API routes use shared fail-closed context resolution or explicit provider ingress", () => {
  const routeFiles = walk(apiRoot)
    .filter(isRouteFile)
    .map((path) => relative(repoRoot.pathname, path))
    .sort();

  assert.ok(routeFiles.length > 0, "expected production API routes to be discovered");

  const violations: string[] = [];
  for (const rel of routeFiles) {
    if (publicOrProviderExceptions.has(rel)) continue;
    const content = readFileSync(join(repoRoot.pathname, rel), "utf8");
    if (!contextMarkers.some((marker) => content.includes(marker))) {
      violations.push(`${rel}: does not use shared context resolution`);
    }
  }

  assert.deepEqual(violations, []);
});
