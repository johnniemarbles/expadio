import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const route = read("../app/api/crm/cases/[id]/workflow/route.ts");
const runtime = read("../lib/workflow-runtime.ts");
const stageEvents = read("../lib/crm-case-stage-events.ts");
const migration = read("../../../infra/db/migrations/0049_crm_case_blueprint.sql");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("the runtime drives the real workflow domain + persistence adapters", () => {
  assert.match(runtime, /PostgresWorkflowBlueprintRepository/);
  assert.match(runtime, /PostgresWorkflowInstanceRepository/);
  assert.match(runtime, /instantiateWorkflowBlueprint/);
  assert.match(runtime, /commitWorkflowStageTransition/);
  // Optimistic concurrency is honoured through the adapter's atomic commit.
  assert.match(runtime, /commitTransition/);
  assert.match(runtime, /expectedRevision/);
});

test("the case workflow route is governed and binds the case to the instance", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /hasCrmWriteRole/);
  assert.match(route, /startWorkflow/);
  assert.match(route, /transitionWorkflow/);
  assert.match(route, /industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source/);
  assert.match(route, /industryPackProvenance: workflowPackProvenanceFromRow/);
  assert.match(runtime, /industryPackProvenance\?: WorkflowIndustryPackProvenance/);
  assert.match(runtime, /industryPackProvenance: input\.industryPackProvenance/);
  // Case mirrors the instance's current stage so the surfaces never drift.
  assert.match(route, /UPDATE platform\.crm_cases[\s\S]*workflow_instance_id/);
  assert.match(route, /UPDATE platform\.crm_cases SET stage_key/);
});

test("a platform crm.case blueprint is seeded and active", () => {
  assert.match(migration, /INSERT INTO platform\.workflow_blueprints/);
  assert.match(migration, /'crm\.case'/);
  assert.match(migration, /'ACTIVE'/);
  // Platform-scoped (tenant_id NULL) so every tenant can bind to it.
  assert.match(migration, /NULL, 'crm\.case'/);
  assert.match(migration, /"stageKey": "INTAKE"/);
});

test("the Cases surface can start and advance a workflow", () => {
  assert.match(client, /startCaseWorkflow/);
  assert.match(client, /advanceCase/);
  assert.match(client, /WorkflowCell/);
  assert.match(client, /Start workflow/);
});


test("case workflow transition appends a generic Domain Event before transaction commit", () => {
  assert.match(route, /appendCrmCaseStageChangedEvent\(client/);
  assert.match(route, /previousStageKey/);
  assert.match(route, /currentStageKey: moved\.instance\.currentStageKey/);
  assert.match(route, /revision: moved\.instance\.revision/);
  assert.match(route, /correlationId: request\.headers\.get\('x-correlation-id'\)/);
  assert.match(
    route,
    /appendCrmCaseStageChangedEvent\(client[\s\S]*await client\.query\('COMMIT'\)/,
  );

  assert.match(stageEvents, /eventType: 'crm\.case\.stage_changed'/);
  assert.match(stageEvents, /appendDomainEventWithOutbox/);
  assert.match(stageEvents, /aggregateType: 'crm\.case'/);
  assert.match(stageEvents, /partitionKey: `crm\.case:\$\{input\.caseId\}`/);
  assert.doesNotMatch(stageEvents, /dentex|lexflow/i);
});
