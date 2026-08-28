import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const authority = read("../lib/workflow-authority.ts");
const runtime = read("../lib/workflow-runtime.ts");
const decisionRoute = read("../app/api/crm/cases/[id]/workflow/decision/route.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("separation-of-duties authority denies self-approval", () => {
  assert.match(authority, /WorkflowApprovalAuthorityProvider/);
  assert.match(authority, /WORKFLOW_SOD_SELF_APPROVAL/);
  assert.match(authority, /maker === checker/);
});

test("decision capture goes through the authority-gated service", () => {
  assert.match(runtime, /AuthorityGatedWorkflowDecisionCaptureService/);
  assert.match(runtime, /SeparationOfDutiesAuthorityProvider/);
  assert.match(runtime, /AUTHORITY_DENIED/);
  // The maker is the subject who advanced the instance into the stage.
  assert.match(runtime, /makerForStage/);
  assert.match(runtime, /to_stage_key = \$3/);
});

test("the decision route derives the maker and surfaces an authority denial", () => {
  assert.match(decisionRoute, /makerForStage/);
  assert.match(decisionRoute, /makerSubjectId/);
  assert.match(decisionRoute, /AUTHORITY_DENIED/);
  assert.match(decisionRoute, /status: 403/);
});

test("the Cases surface explains the four-eyes rule", () => {
  assert.match(client, /Four-eyes/);
});
