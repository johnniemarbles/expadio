import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const route = read("../app/api/crm/agreements/route.ts");
const patch = read("../app/api/crm/agreements/[id]/route.ts");
const migration = read("../../../infra/db/migrations/0047_crm_agreements.sql");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("agreements route is governed, tenant-scoped, and uses the agreement domain", () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /hasCrmWriteRole/);
  assert.match(route, /validateAgreementInput/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
});

test("agreement status changes are a governed PATCH", () => {
  assert.match(patch, /export async function PATCH/);
  assert.match(patch, /validateAgreementStatus/);
  assert.match(patch, /reasonKey: 'FORBIDDEN'/);
});

test("agreements table is RLS-forced and tied to a customer account with lead provenance", () => {
  assert.match(migration, /CREATE TABLE platform\.crm_agreements/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(tenant_id = platform\.current_tenant_id\(\)\)/);
  assert.match(migration, /account_id uuid NOT NULL REFERENCES platform\.crm_accounts/);
  assert.match(migration, /source_lead_id uuid REFERENCES platform\.crm_leads/);
});

test("CRM client surfaces agreements with status moves and contract value", () => {
  assert.match(client, /reloadAgreements/);
  assert.match(client, /moveAgreement/);
  assert.match(client, /activeContractMinor/);
  assert.match(client, /AgreementModal/);
});
