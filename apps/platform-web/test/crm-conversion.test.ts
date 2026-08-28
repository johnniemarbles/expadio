import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const convertRoute = read("../app/api/crm/leads/[id]/convert/route.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("conversion is a governed, tenant-scoped, atomic transaction", () => {
  assert.match(convertRoute, /export async function POST/);
  assert.match(convertRoute, /resolveRequestContext\(request\)/);
  assert.match(convertRoute, /withTenantClient/);
  assert.match(convertRoute, /hasCrmWriteRole/);
  // The whole funnel step is one transaction — all of it lands or none does.
  assert.match(convertRoute, /BEGIN/);
  assert.match(convertRoute, /COMMIT/);
  assert.match(convertRoute, /ROLLBACK/);
});

test("conversion promotes/creates a CUSTOMER account and marks the lead WON", () => {
  assert.match(convertRoute, /lifecycle_stage = 'CUSTOMER'/);
  assert.match(convertRoute, /lifecycle_stage\)\s*\n\s*VALUES \(\$1::uuid, \$2, 'CUSTOMER'\)/);
  assert.match(convertRoute, /stage = 'WON'/);
});

test("conversion optionally opens an onboarding case", () => {
  assert.match(convertRoute, /openCase/);
  assert.match(convertRoute, /INSERT INTO platform\.crm_cases/);
});

test("a lost lead cannot be converted", () => {
  assert.match(convertRoute, /'LOST'/);
  assert.match(convertRoute, /reasonKey: 'FORBIDDEN'|lost: true/);
});

test("CRM client offers a Convert action wired to the convert endpoint", () => {
  assert.match(client, /Convert →/);
  assert.match(client, /\/convert\$\{queryString\}/);
  assert.match(client, /ConvertModal/);
});
