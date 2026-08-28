import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const runtime = read("../lib/workflow-runtime.ts");
const route = read("../app/api/crm/cases/[id]/workflow/route.ts");
const decisionRoute = read("../app/api/crm/cases/[id]/workflow/decision/route.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("transitions are gated by the blueprint decision guard", () => {
  assert.match(runtime, /WorkflowStageDecisionGateEvaluator/);
  assert.match(runtime, /PostgresWorkflowStageDecisionRepository/);
  // The gate is evaluated before the instance commit and can block it.
  assert.match(runtime, /gateDecision\.allowed/);
  assert.match(runtime, /reason: 'GATE_BLOCKED'/);
});

test("decision capture writes an immutable stage decision", () => {
  assert.match(runtime, /recordCaseDecision/);
  assert.match(runtime, /AuthorityGatedWorkflowDecisionCaptureService/);
  assert.match(runtime, /CONFLICT/);
});

test("the transition route surfaces a gate block distinctly", () => {
  assert.match(route, /GATE_BLOCKED/);
  assert.match(route, /WORKFLOW_DECISION_REQUIRED/);
});

test("the decision route is governed and records against the current stage", () => {
  assert.match(decisionRoute, /export async function POST/);
  assert.match(decisionRoute, /resolveRequestContext\(request\)/);
  assert.match(decisionRoute, /hasCrmWriteRole/);
  assert.match(decisionRoute, /recordCaseDecision/);
  assert.match(decisionRoute, /currentStageKey/);
});

test("the Cases surface gates advancing behind a recorded decision", () => {
  assert.match(client, /decideCase/);
  assert.match(client, /decisionRequired/);
  assert.match(client, /Decide…|Decide/);
  assert.match(client, /currentDecision/);
});
