import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const productionRoots = ["apps/platform-web/app/api", "apps/platform-web/lib"];
const textExtensions = new Set([".ts", ".tsx"]);
const resolverBoundary = "apps/platform-web/lib/provider-webhook-secrets.ts";
const allowedProviderSecretFiles = new Set([resolverBoundary]);
const providerSecretEnvPattern = /process\.env\.(?:RESEND_WEBHOOK_SECRET|TWILIO_AUTH_TOKEN)\b/u;

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

test("provider webhook secrets are read only through the resolver boundary", () => {
  const violations: string[] = [];
  const files = productionRoots.flatMap((root) => walk(join(repoRoot.pathname, root)));

  for (const file of files) {
    if (!textExtensions.has(extname(file))) continue;
    const rel = relative(repoRoot.pathname, file);
    if (allowedProviderSecretFiles.has(rel)) continue;

    const content = readFileSync(file, "utf8");
    if (providerSecretEnvPattern.test(content)) {
      violations.push(`${rel}: reads provider webhook secret environment directly`);
    }
  }

  assert.deepEqual(violations, []);
});

test("provider webhook secret resolver fails closed on missing signing material", () => {
  const resolver = readFileSync(join(repoRoot.pathname, resolverBoundary), "utf8");

  assert.match(resolver, /function\s+requireProviderWebhookSecret\s*\(/u);
  assert.match(resolver, /process\.env\[name\]\?\.trim\(\)/u);
  assert.match(resolver, /throw\s+new\s+Error\(`\$\{name\}_MISSING`\)/u);
  assert.match(resolver, /resolveResendWebhookSecret\([^)]*\):\s*string/u);
  assert.match(resolver, /resolveTwilioAuthToken\([^)]*\):\s*string/u);
  assert.doesNotMatch(resolver, /:\s*string\s*\|\s*undefined/u);
  assert.doesNotMatch(resolver, /return\s+process\.env\.(?:RESEND_WEBHOOK_SECRET|TWILIO_AUTH_TOKEN)\b/u);
});
