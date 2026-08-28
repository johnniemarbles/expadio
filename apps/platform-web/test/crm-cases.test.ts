import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const casesRoute = read("../app/api/crm/cases/route.ts");
const casePatch = read("../app/api/crm/cases/[id]/route.ts");
const migration = read("../../../infra/db/migrations/0046_crm_cases.sql");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("cases route is governed, tenant-scoped, and uses the case domain", () => {
  assert.match(casesRoute, /resolveRequestContext\(request\)/);
  assert.match(casesRoute, /withTenantClient/);
  assert.match(casesRoute, /hasCrmWriteRole/);
  assert.match(casesRoute, /validateCaseInput/);
  assert.match(casesRoute, /export async function GET/);
  assert.match(casesRoute, /export async function POST/);
});

test("case status/priority changes are a governed PATCH", () => {
  assert.match(casePatch, /export async function PATCH/);
  assert.match(casePatch, /validateCaseStatus/);
  assert.match(casePatch, /validateCasePriority/);
  assert.match(casePatch, /reasonKey: 'FORBIDDEN'/);
});

test("cases table is RLS-forced and carries the Decision Fabric seam", () => {
  assert.match(migration, /CREATE TABLE platform\.crm_cases/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(tenant_id = platform\.current_tenant_id\(\)\)/);
  // blueprint_key + workflow_instance_id are the workflow binding seam.
  assert.match(migration, /blueprint_key text/);
  assert.match(migration, /workflow_instance_id uuid/);
});

test("CRM client surfaces cases with status moves and blueprint linkage", () => {
  assert.match(client, /Cases/);
  assert.match(client, /moveCase/);
  assert.match(client, /Open cases/);
  assert.match(client, /Workflow blueprint/);
});
