import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const evaluator = read("../lib/workflow-conditions.ts");
const runtime = read("../lib/workflow-runtime.ts");
const migration = read("../../../infra/db/migrations/0051_crm_case_conditions.sql");
const caseRoute = read("../app/api/crm/cases/[id]/route.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("the condition evaluator checks case data and fails closed on unknown", () => {
  assert.match(evaluator, /class CrmCaseConditionEvaluator/);
  assert.match(evaluator, /implements WorkflowConditionEvaluator/);
  assert.match(evaluator, /case 'case\.has_account'/);
  assert.match(evaluator, /WORKFLOW_CONDITION_UNKNOWN/);
});

test("the transition gate evaluates exit + entry conditions first", () => {
  assert.match(runtime, /CrmCaseConditionEvaluator/);
  assert.match(runtime, /exitConditions/);
  assert.match(runtime, /entryConditions/);
  assert.match(runtime, /ENTRY_CONDITION/);
});

test("the crm.case terminal stage requires a linked account", () => {
  assert.match(migration, /UPDATE platform\.workflow_blueprints/);
  assert.match(migration, /"entryConditions": \[\{ "type": "case\.has_account" \}\]/);
});

test("the case PATCH can link an account (condition recovery)", () => {
  assert.match(caseRoute, /body\.accountId/);
  assert.match(caseRoute, /account_id = CASE WHEN/);
});

test("the Cases surface offers linking an account", () => {
  assert.match(client, /linkCaseAccount/);
  assert.match(client, /Link account…/);
});
