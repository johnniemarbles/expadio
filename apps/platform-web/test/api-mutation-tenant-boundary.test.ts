import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const apiRoot = join(repoRoot.pathname, "apps/platform-web/app/api");

const mutationHandlerPattern = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/u;
const sharedTenantBoundaryMarkers = [
  "resolveRequestContext(",
  "withTenantClient(",
  "requireStepUp(",
  "ingestCommunicationProviderWebhook(",
  "WEBHOOK_TENANT_REQUIRED",
  "WEBHOOK_CONNECTOR_REQUIRED",
];

const providerIngressRoutes = new Set([
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
  return /route\.tsx?$/u.test(path);
}

test("mutating production API routes use tenant boundary or explicit provider ingress", () => {
  const routeFiles = walk(apiRoot).filter(isRouteFile);
  const violations: string[] = [];

  for (const file of routeFiles) {
    const rel = relative(repoRoot.pathname, file);
    const content = readFileSync(file, "utf8");
    if (!mutationHandlerPattern.test(content)) continue;

    const hasSharedBoundary = sharedTenantBoundaryMarkers.some((marker) => content.includes(marker));
    const isProviderIngress = providerIngressRoutes.has(rel)
      && content.includes("WEBHOOK_TENANT_REQUIRED")
      && content.includes("WEBHOOK_CONNECTOR_REQUIRED");

    if (!hasSharedBoundary && !isProviderIngress) {
      violations.push(`${rel}: mutating handler lacks shared tenant boundary or explicit provider ingress validation`);
    }
  }

  assert.deepEqual(violations.sort(), []);
});
