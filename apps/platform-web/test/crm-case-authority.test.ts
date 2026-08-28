import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const authority = read("../lib/workflow-authority.ts");
const authz = read("../lib/crm-authz.ts");
const runtime = read("../lib/workflow-runtime.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("the authority provider enforces a governing role and records it", () => {
  assert.match(authority, /class RoleAndSeparationOfDutiesAuthorityProvider/);
  assert.match(authority, /WORKFLOW_AUTHORITY_ROLE_MISSING/);
  // The satisfying role is recorded as authority evidence.
  assert.match(authority, /authority:role:\$\{roleKey\}/);
  assert.match(authority, /roleKey/);
});

test("the governing-role resolver ranks platform over tenant roles", () => {
  assert.match(authz, /resolveGoverningRole/);
  assert.match(authz, /ROLE_RANK/);
  assert.match(authz, /PLATFORM_SUPER_ADMIN/);
});

test("decision capture uses the role+SoD provider with the real role lookup", () => {
  assert.match(runtime, /RoleAndSeparationOfDutiesAuthorityProvider/);
  assert.match(runtime, /resolveGoverningRole\(client, subjectId\)/);
});

test("the trace carries decision authority evidence", () => {
  assert.match(runtime, /evidence_refs/);
  assert.match(runtime, /evidenceRefs: Array\.isArray/);
  assert.match(client, /e\.evidenceRefs/);
});
