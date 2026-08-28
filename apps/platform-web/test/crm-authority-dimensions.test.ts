import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const migration = read("../../../infra/db/migrations/0052_workflow_authority_grants.sql");
const grants = read("../lib/workflow-authority-grants.ts");
const authority = read("../lib/workflow-authority.ts");
const runtime = read("../lib/workflow-runtime.ts");
const derivation = read("../lib/workflow-authority-derivation.ts");
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

test("authority derivation is a work-type registry, not a CRM special case", () => {
  // The generic decision path dispatches by work type; it no longer names CRM.
  assert.match(runtime, /deriveAuthorityRequirements/);
  assert.match(runtime, /workTypeKey: input\.workTypeKey/);
  assert.doesNotMatch(runtime, /crm_agreements/);
  assert.match(runtime, /resolveAuthorityGrants/);
});

test("crm.case registers a deriver that reads the account's agreements", () => {
  assert.match(derivation, /registerAuthorityDeriver\('crm\.case'/);
  assert.match(derivation, /crm_agreements/);
  assert.match(derivation, /monetary\.approval/);
  // An unregistered work type falls through to no requirement.
  assert.match(derivation, /if \(deriver === undefined\) return \[\]/);
});

test("the authority grants route is governed and tenant-scoped", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /hasCrmWriteRole/);
  assert.match(route, /grantAuthority/);
});
