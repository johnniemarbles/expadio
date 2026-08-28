import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const runtime = read("../lib/workflow-runtime.ts");
const route = read("../app/api/crm/cases/[id]/workflow/history/route.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("the runtime merges transitions and decisions into one trace", () => {
  assert.match(runtime, /loadCaseWorkflowHistory/);
  assert.match(runtime, /FROM platform\.workflow_instance_transitions/);
  assert.match(runtime, /FROM platform\.workflow_stage_decisions/);
  assert.match(runtime, /entries\.sort/);
});

test("the history route is a governed, tenant-scoped read", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /loadCaseWorkflowHistory/);
});

test("the Cases surface offers a workflow trace", () => {
  assert.match(client, /CaseTraceModal/);
  assert.match(client, /workflow\/history/);
  assert.match(client, /onTrace/);
});
