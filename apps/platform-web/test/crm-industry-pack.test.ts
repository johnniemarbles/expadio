import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const route = read("../app/api/tenancy/vertical/route.ts");
const page = read("../app/(shell)/crm/page.tsx");
const client = read("../app/(shell)/crm/CrmClient.tsx");
const migration = read("../../../infra/db/migrations/0048_tenant_vertical.sql");

test("the vertical endpoint is a governed, tenant-scoped read + write", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /hasCrmWriteRole/);
  // Only a known pack may be set; empty clears back to the neutral engine.
  assert.match(route, /findIndustryPack/);
  assert.match(route, /UPDATE platform\.tenants SET vertical_key/);
});

test("the tenant vertical binding is added by migration", () => {
  assert.match(migration, /ALTER TABLE platform\.tenants ADD COLUMN IF NOT EXISTS vertical_key text/);
});

test("the CRM page resolves vocabulary from the active pack, server-side", () => {
  assert.match(page, /resolveCrmVocabulary/);
  assert.match(page, /findIndustryPack/);
  assert.match(page, /\/api\/tenancy\/vertical/);
  // Explicit ?vertical= previews; the tenant binding is the default.
  assert.match(page, /previewVertical/);
  assert.match(page, /boundVertical/);
});

test("the CRM client renders through the vocabulary and offers a pack picker", () => {
  assert.match(client, /vocab\.account\.plural/);
  assert.match(client, /vocab\.case\.singular/);
  assert.match(client, /changeVertical/);
  assert.match(client, /Industry pack/);
  assert.match(client, /Neutral engine/);
});

test('a pack can configure case domain fields, stored and validated', () => {
  const casesRoute = read('../app/api/crm/cases/route.ts');
  // The create route validates pack-declared attributes and stores them as JSONB.
  assert.match(casesRoute, /findIndustryPack/);
  assert.match(casesRoute, /resolveCaseSchema/);
  assert.match(casesRoute, /validateCaseAttributes/);
  assert.match(casesRoute, /attributes[\s\S]*\$10::jsonb/);
  // The subject table gains the attributes column by migration.
  const migration = read('../../../infra/db/migrations/0057_crm_case_attributes.sql');
  assert.match(migration, /ALTER TABLE platform\.crm_cases[\s\S]*ADD COLUMN IF NOT EXISTS attributes jsonb/);
});

test("the case create form renders the pack's declared fields and sends them", () => {
  // The page resolves the pack's case schema server-side and threads it down.
  assert.match(page, /resolveCaseSchema/);
  assert.match(page, /caseSchema=\{caseSchema\}/);
  // The client renders an input per declared field and posts them as attributes.
  assert.match(client, /caseSchema: CaseSchema/);
  assert.match(client, /fields=\{caseSchema\.fields\}/);
  assert.match(client, /fields\.map/);
  assert.match(client, /attributes: attrs/);
});

test("the case workflow speaks the active pack's process language", () => {
  // The page resolves the pack's case-workflow vocabulary server-side and passes it down.
  assert.match(page, /resolveCaseWorkflowVocabulary/);
  assert.match(page, /caseVocab=\{caseVocab\}/);
  // The client relabels canonical stage keys through the pack vocabulary at display time.
  assert.match(client, /caseVocab: CaseWorkflowVocabulary/);
  assert.match(client, /const stageLabel =/);
  assert.match(client, /stageLabel\(s\.stageKey\)/);
});
