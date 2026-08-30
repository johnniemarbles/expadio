import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../..", import.meta.url);
const fleetRoutePath = "apps/platform-web/app/api/communications/fleet/route.ts";

function readFleetRoute(): string {
  return readFileSync(join(repoRoot.pathname, fleetRoutePath), "utf8");
}

test("communications fleet telemetry is scoped to the current tenant only", () => {
  const content = readFleetRoute();

  assert.match(content, /resolveRequestContext\s*\(/u, "fleet route must resolve workspace context");
  assert.match(content, /withTenantClient\s*\(/u, "fleet route must execute through tenant client boundary");
  assert.match(content, /tenant_id\s*=\s*\$1::uuid/u, "fleet aggregate must filter by the selected tenant id");
  assert.match(content, /\[effectiveContext\.tenantId\]/u, "fleet aggregate must bind the selected tenant id");
  assert.doesNotMatch(content, /OR\s+tenant_id\s+IS\s+NOT\s+NULL/iu, "fleet aggregate must not include other tenants");
  assert.doesNotMatch(content, /tenant_id\s+IS\s+NOT\s+NULL/iu, "fleet aggregate must not use broad tenant existence predicates");
});
