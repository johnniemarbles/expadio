import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const listRoute = read("../app/api/communications/suppressions/route.ts");
const revokeRoute = read("../app/api/communications/suppressions/[suppressionId]/route.ts");
const panel = read("../app/(shell)/communications/suppressions/SuppressionPanel.tsx");
const page = read("../app/(shell)/communications/suppressions/page.tsx");
const spine = read("../../../packages/communication/src/spine.ts");

test("suppression trace remediation points to a real control-plane page", () => {
  assert.match(spine, /href:\s*['"]\/communications\/suppressions['"]/);
  assert.match(page, /SuppressionPanel/);
  assert.match(page, /Suppression control plane/);
});

test("suppression API is tenant-bound and admin-gated", () => {
  for (const source of [listRoute, revokeRoute]) {
    assert.match(source, /resolveRequestContext/);
    assert.match(source, /withTenantClient/);
    assert.match(source, /PLATFORM_SUPER_ADMIN/);
    assert.match(source, /TENANT_OWNER/);
    assert.match(source, /TENANT_ADMIN/);
    assert.doesNotMatch(source, /00000000-0000-0000-0000-000000000001/);
  }
  assert.match(listRoute, /tenant_id = \$1::uuid/);
  assert.match(listRoute, /PostgresCommunicationSuppressionRepository/);
  assert.match(revokeRoute, /repository\.revoke/);
});

test("suppression control plane cannot mutate platform-global suppression policy", () => {
  assert.match(panel, /tenant-scoped/);
  assert.match(panel, /cannot create or alter platform-global suppression policy/);
  assert.doesNotMatch(listRoute, /platform_global/i);
  assert.doesNotMatch(revokeRoute, /platform_global/i);
});

test("manual suppressions reject unsupported channels and duplicate active rows", () => {
  assert.match(listRoute, /communicationChannelMetadata\(channel\)\.supportsSuppression/);
  assert.match(listRoute, /SUPPRESSION_CHANNELS/);
  assert.doesNotMatch(listRoute, /['"]in_app['"].*SUPPRESSION_CHANNELS/);
  assert.doesNotMatch(listRoute, /['"]social['"].*SUPPRESSION_CHANNELS/);
  assert.match(listRoute, /error\?\.code === ['"]23505['"]/);
  assert.match(panel, /Future sends may become eligible again if all other policy checks pass/);
});
