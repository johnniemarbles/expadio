import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);

const productionRoots = [
  "apps/platform-web/app/api",
  "apps/platform-web/lib",
];

const textExtensions = new Set([".ts", ".tsx"]);

const allowedDirectDbPoolQueryFiles = new Set([
  // Centralized helpers may own raw pool access before applying request context.
  "apps/platform-web/lib/request-context.ts",
  "apps/platform-web/lib/iam-adapter.ts",
]);

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

test("tenant data access does not bypass the shared RLS context boundary", () => {
  const files = productionRoots.flatMap((root) => walk(join(repoRoot.pathname, root)));
  const violations: string[] = [];

  for (const file of files) {
    const rel = relative(repoRoot.pathname, file);
    if (!textExtensions.has(extname(file))) continue;
    const content = readFileSync(file, "utf8");

    if (allowedDirectDbPoolQueryFiles.has(rel)) continue;

    if (/\bdbPool\.query\s*\(/u.test(content)) {
      violations.push(`${rel}: uses dbPool.query directly instead of shared tenant context helpers`);
    }

    if (/\bdbPool\.connect\s*\(/u.test(content) && !content.includes("set_config")) {
      violations.push(`${rel}: opens a pooled client without an explicit tenant session boundary`);
    }
  }

  assert.deepEqual(violations.sort(), []);
});
