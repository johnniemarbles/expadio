import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const migration = read("../../../infra/db/migrations/0050_workflow_participants.sql");
const participants = read("../lib/workflow-participants.ts");
const runtime = read("../lib/workflow-runtime.ts");
const route = read("../app/api/crm/cases/[id]/workflow/participants/route.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("participant assignments are RLS-forced and REVIEW requires a reviewer", () => {
  assert.match(migration, /CREATE TABLE platform\.workflow_participant_assignments/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(tenant_id = platform\.current_tenant_id\(\)\)/);
  assert.match(migration, /"requiredParticipantKeys": \["reviewer"\]/);
});

test("the participant provider + assignment persistence exist", () => {
  assert.match(participants, /class PostgresParticipantAssignmentProvider/);
  assert.match(participants, /implements WorkflowParticipantAssignmentProvider/);
  assert.match(participants, /assignParticipant/);
  assert.match(participants, /ON CONFLICT \(tenant_id, instance_id, stage_key, participant_key\)/);
});

test("the participant gate is enforced on transition", () => {
  assert.match(runtime, /WorkflowParticipantAssignmentGateEvaluator/);
  assert.match(runtime, /PostgresParticipantAssignmentProvider/);
});

test("the assign route is governed and tenant-scoped", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /hasCrmWriteRole/);
  assert.match(route, /assignParticipant/);
});

test("the Cases surface offers assigning a required participant", () => {
  assert.match(client, /assignMe/);
  assert.match(client, /requiredParticipantKeys/);
  assert.match(client, /Assign…/);
});
