import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const vendorsRoute = read('../app/api/vendors/route.ts');
const workflowRoute = read('../app/api/vendors/[id]/workflow/route.ts');
const participantsRoute = read('../app/api/vendors/[id]/workflow/participants/route.ts');
const decisionRoute = read('../app/api/vendors/[id]/workflow/decision/route.ts');
const migration = read('../../../infra/db/migrations/0053_vendor_onboarding.sql');
const approvalMigration = read('../../../infra/db/migrations/0054_vendor_onboarding_approval.sql');
const client = read('../app/(shell)/vendors/VendorsClient.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('the vendors list/create route is governed and RLS-scoped', () => {
  assert.match(vendorsRoute, /export async function GET/);
  assert.match(vendorsRoute, /export async function POST/);
  assert.match(vendorsRoute, /resolveRequestContext\(request\)/);
  assert.match(vendorsRoute, /hasGovernanceWriteRole/);
  assert.match(vendorsRoute, /INSERT INTO platform\.vendors/);
  assert.match(vendorsRoute, /'vendor\.onboarding'/);
});

test('the vendor workflow route runs the generic Decision Fabric runtime', () => {
  // The route delegates to the shared factory with the vendor's shared binding.
  assert.match(workflowRoute, /createVerticalWorkflowRoute\(VENDOR_WORKFLOW\)/);
  assert.match(workflowRoute, /export const \{ GET, POST, PATCH \}/);
  // The binding lives once in lib/verticals.ts.
  const verticals = read('../lib/verticals.ts');
  assert.match(verticals, /table: 'platform\.vendors'/);
  assert.match(verticals, /idColumn: 'vendor_id'/);
  assert.match(verticals, /subjectType: 'vendor'/);
  assert.match(verticals, /stageKey === 'ACTIVE' \? 'ACTIVE' : 'PENDING'/);
  // The shared factory carries the generic runtime orchestration.
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /startWorkflow/);
  assert.match(factory, /transitionWorkflow/);
  assert.match(factory, /UPDATE \$\{table\}[\s\S]*workflow_instance_id/);
});

test('the vendor participant route fills the SCREENING compliance slot', () => {
  assert.match(participantsRoute, /createVerticalParticipantsRoute\(VENDOR_WORKFLOW\)/);
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /assignParticipant/);
  assert.match(factory, /hasGovernanceWriteRole/);
});

test('a platform vendor.onboarding blueprint is seeded and active', () => {
  assert.match(migration, /CREATE TABLE platform\.vendors/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /INSERT INTO platform\.workflow_blueprints/);
  assert.match(migration, /NULL, 'vendor\.onboarding'/);
  assert.match(migration, /"stageKey": "SCREENING"/);
  assert.match(migration, /"screener"/);
});

test('the Vendors surface can register, start, screen, approve and activate', () => {
  assert.match(client, /Register vendor/);
  assert.match(client, /Start onboarding/);
  assert.match(client, /Assign screener/);
  assert.match(client, /Advance to approval/);
  assert.match(client, /Approve &amp; activate/);
  assert.match(client, /approveAndActivate/);
  assert.match(nav, /href: '\/vendors'/);
});

test('v2 adds a governed decision stage and the vendor decision route captures it', () => {
  // The blueprint gains a decision-required APPROVAL stage; v1 is superseded.
  assert.match(approvalMigration, /'vendor\.onboarding', 2/);
  assert.match(approvalMigration, /"stageKey": "APPROVAL"/);
  assert.match(approvalMigration, /"decisionRequired": true/);
  assert.match(approvalMigration, /SET state = 'SUPERSEDED'/);
  // The route records the decision through the shared governed-capture factory.
  assert.match(decisionRoute, /createVerticalDecisionRoute\(VENDOR_WORKFLOW\)/);
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /recordCaseDecision/);
  assert.match(factory, /makerForStage/);
  assert.match(factory, /hasGovernanceWriteRole/);
});

test('the vendor workflow exposes its governed trace', () => {
  const historyRoute = read('../app/api/vendors/[id]/workflow/history/route.ts');
  assert.match(historyRoute, /createVerticalHistoryRoute\(VENDOR_WORKFLOW\)/);
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /loadCaseWorkflowHistory/);
  assert.match(client, /WorkflowTraceModal/);
  assert.match(client, /workflow\/history/);
});
