import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const migration = read("../../../infra/db/migrations/0052_workflow_authority_grants.sql");
const grants = read("../lib/workflow-authority-grants.ts");
const authority = read("../lib/workflow-authority.ts");
const runtime = read("../lib/workflow-runtime.ts");
const route = read("../app/api/authority/grants/route.ts");

test("authority grants are RLS-forced and carry scope/delegation", () => {
  assert.match(migration, /CREATE TABLE platform\.workflow_authority_grants/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /threshold_minor_units bigint/);
  assert.match(migration, /scope_type text NOT NULL DEFAULT 'TENANT'/);
  assert.match(migration, /delegated_from_subject_id text/);
});

test("the grant lib reads active grants and records new ones", () => {
  assert.match(grants, /resolveAuthorityGrants/);
  assert.match(grants, /grantAuthority/);
  assert.match(grants, /status = 'ACTIVE'/);
});

test("the authority provider enforces the monetary threshold with scope + delegation", () => {
  assert.match(authority, /monetary\.approval/);
  assert.match(authority, /WORKFLOW_AUTHORITY_THRESHOLD/);
  assert.match(authority, /authority:delegation:/);
  assert.match(authority, /scopeCovers/);
  // Org scope entities are UUIDs compared case-insensitively.
  assert.match(authority, /sameEntity/);
  // Unknown authority requirement dimensions fail closed.
  assert.match(authority, /WORKFLOW_AUTHORITY_REQUIREMENT_UNKNOWN/);
});

test("the decision derives its monetary requirement from the case's agreements", () => {
  assert.match(runtime, /deriveAuthorityRequirements/);
  assert.match(runtime, /crm_agreements/);
  assert.match(runtime, /resolveAuthorityGrants/);
});

test("the authority grants route is governed and tenant-scoped", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /hasCrmWriteRole/);
  assert.match(route, /grantAuthority/);
});
