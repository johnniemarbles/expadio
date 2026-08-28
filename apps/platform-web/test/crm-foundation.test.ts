import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const accountsRoute = read("../app/api/crm/accounts/route.ts");
const contactsRoute = read("../app/api/crm/contacts/route.ts");
const migration = read("../../../infra/db/migrations/0044_crm_party.sql");
const authz = read("../lib/crm-authz.ts");

test("CRM routes are governed and tenant-scoped, using the party domain", () => {
  for (const route of [accountsRoute, contactsRoute]) {
    assert.match(route, /resolveRequestContext\(request\)/);
    assert.match(route, /withTenantClient/);
    assert.match(route, /hasCrmWriteRole/);
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
  }
  assert.match(accountsRoute, /validateAccountInput/);
  assert.match(contactsRoute, /validateContactInput/);
});

test("CRM writes require a governing role; reads only require membership", () => {
  assert.match(authz, /TENANT_OWNER/);
  assert.match(authz, /PLATFORM_SUPER_ADMIN/);
  // A missing write role denies with FORBIDDEN rather than silently inserting.
  assert.match(accountsRoute, /reasonKey: 'FORBIDDEN'/);
});

test("CRM tables are RLS-forced and tenant-isolated at the data layer", () => {
  assert.match(migration, /CREATE TABLE platform\.crm_accounts/);
  assert.match(migration, /CREATE TABLE platform\.crm_contacts/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(tenant_id = platform\.current_tenant_id\(\)\)/);
  assert.match(migration, /WITH CHECK \(tenant_id = platform\.current_tenant_id\(\)\)/);
});
