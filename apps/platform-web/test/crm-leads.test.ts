import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const leadsRoute = read("../app/api/crm/leads/route.ts");
const stageRoute = read("../app/api/crm/leads/[id]/route.ts");
const migration = read("../../../infra/db/migrations/0045_crm_leads.sql");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("leads route is governed, tenant-scoped, and uses the lead domain", () => {
  assert.match(leadsRoute, /resolveRequestContext\(request\)/);
  assert.match(leadsRoute, /withTenantClient/);
  assert.match(leadsRoute, /hasCrmWriteRole/);
  assert.match(leadsRoute, /validateLeadInput/);
  assert.match(leadsRoute, /export async function GET/);
  assert.match(leadsRoute, /export async function POST/);
});

test("lead stage transitions are a governed PATCH", () => {
  assert.match(stageRoute, /export async function PATCH/);
  assert.match(stageRoute, /validateStage/);
  assert.match(stageRoute, /hasCrmWriteRole/);
  assert.match(stageRoute, /reasonKey: 'FORBIDDEN'/);
});

test("leads table is RLS-forced and tenant-isolated", () => {
  assert.match(migration, /CREATE TABLE platform\.crm_leads/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(tenant_id = platform\.current_tenant_id\(\)\)/);
});

test("CRM client surfaces a leads pipeline with stage moves", () => {
  assert.match(client, /Leads/);
  assert.match(client, /moveLead/);
  assert.match(client, /Open pipeline/);
});
