import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const productionRoots = ["apps/platform-web/app/api", "apps/platform-web/lib", "packages"];
const textExtensions = new Set([".ts", ".tsx"]);

const ignoredSegments = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "test",
  "tests",
  "fixtures",
  "__fixtures__",
  "__tests__",
]);

const broadTenantPredicates = [
  /OR\s+tenant_id\s+IS\s+NOT\s+NULL/iu,
  /OR\s+[^`'\n;]*\.tenant_id\s+IS\s+NOT\s+NULL/iu,
  /tenant_id\s+IS\s+NOT\s+NULL\s+OR/iu,
  /\.tenant_id\s+IS\s+NOT\s+NULL\s+OR/iu,
  /tenant_id\s*<>\s*['"]?00000000-0000-0000-0000-000000000000['"]?/iu,
];

function shouldIgnore(path: string): boolean {
  return path.split(/[\\/]/u).some((segment) => ignoredSegments.has(segment));
}

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

test("production code does not use broad tenant predicates", () => {
  const violations: string[] = [];
  const files = productionRoots.flatMap((root) => walk(join(repoRoot.pathname, root)));

  for (const file of files) {
    if (!textExtensions.has(extname(file))) continue;
    const rel = relative(repoRoot.pathname, file);
    if (shouldIgnore(rel)) continue;

    const content = readFileSync(file, "utf8");
    for (const pattern of broadTenantPredicates) {
      if (pattern.test(content)) {
        violations.push(`${rel}: contains a broad tenant predicate`);
        break;
      }
    }
  }

  assert.deepEqual(violations, []);
});
