import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const productionRoots = ["apps/platform-web/app/api"];
const textExtensions = new Set([".ts", ".tsx"]);

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

const leakPatterns = [
  /message\s*:\s*(?:error|err)\.message\b/u,
  /message\s*:\s*(?:error|err)\.message\s*\|\|/u,
  /message\s*:\s*(?:error|err)\.message\s*\?\?/u,
  /NextResponse\.json\s*\(\s*\{[^}]*message\s*:\s*(?:error|err)\.message/gsu,
];

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

test("production API routes do not leak raw internal error messages", () => {
  const violations: string[] = [];
  const files = productionRoots.flatMap((root) => walk(join(repoRoot.pathname, root)));

  for (const file of files) {
    if (!textExtensions.has(extname(file))) continue;
    const rel = relative(repoRoot.pathname, file);
    const content = readFileSync(file, "utf8");

    for (const pattern of leakPatterns) {
      if (pattern.test(content)) {
        violations.push(`${rel}: serializes raw error.message or err.message`);
        break;
      }
    }
  }

  assert.deepEqual(violations.sort(), []);
});
