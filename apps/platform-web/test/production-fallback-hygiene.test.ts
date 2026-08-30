import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);

const productionRoots = [
  "apps/platform-web/app/api",
  "apps/platform-web/lib",
  "packages",
];

const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
]);

const forbiddenContent = [
  "00000000-0000-0000-0000-000000000001",
  "default-resend",
  "default-twilio",
  "default connector",
  "default provider",
  "demo tenant",
  "dummy data",
  "mock data",
  "sample data",
  "simulated empty-state",
  "Fallback if empty",
  "fallback if empty",
];

const forbiddenPatterns: Array<[RegExp, string]> = [
  [/\bTODO\b/u, "TODO marker"],
  [/\bFIXME\b/u, "FIXME marker"],
  [/\bHACK\b/u, "HACK marker"],
  [/\bXXX\b/u, "XXX marker"],
  [/\.tmp(?:\.|$)/u, "temporary file"],
];

const ignoredSegments = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "test",
  "tests",
  "__tests__",
  "fixtures",
]);

function shouldIgnorePath(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => ignoredSegments.has(segment));
}

function walk(path: string): string[] {
  if (!existsSync(path) || shouldIgnorePath(relative(repoRoot.pathname, path))) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];

  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

test("production request/runtime paths do not contain demo fallbacks or unresolved markers", () => {
  const files = productionRoots.flatMap((root) => walk(join(repoRoot.pathname, root)));
  const violations: string[] = [];

  for (const file of files) {
    const rel = relative(repoRoot.pathname, file);
    if (!textExtensions.has(extname(file))) continue;

    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(rel)) {
        violations.push(`${rel}: contains forbidden production path marker ${label}`);
      }
    }

    const content = readFileSync(file, "utf8");
    for (const forbidden of forbiddenContent) {
      if (content.includes(forbidden)) {
        violations.push(`${rel}: contains forbidden production fallback marker ${forbidden}`);
      }
    }
    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(content)) {
        violations.push(`${rel}: contains forbidden production content marker ${label}`);
      }
    }
  }

  assert.deepEqual(violations.sort(), []);
});
