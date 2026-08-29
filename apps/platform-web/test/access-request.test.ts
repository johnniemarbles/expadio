import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0056_access_request.sql');
const listRoute = read('../app/api/access-requests/route.ts');
const workflowRoute = read('../app/api/access-requests/[id]/workflow/route.ts');
const decisionRoute = read('../app/api/access-requests/[id]/workflow/decision/route.ts');
const client = read('../app/(shell)/access-requests/AccessRequestsClient.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('the access.request table and blueprint are seeded, RLS-forced, decision-gated', () => {
  assert.match(migration, /CREATE TABLE platform\.access_requests/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = platform\.current_tenant_id\(\)/);
  assert.match(migration, /NULL, 'access\.request', 1/);
  assert.match(migration, /"stageKey": "SECURITY_REVIEW"/);
  assert.match(migration, /"requiredParticipantKeys": \["security_reviewer"\]/);
  assert.match(migration, /"decisionRequired": true/);
});

test('the access-request routes are governed and run the generic runtime', () => {
  assert.match(listRoute, /INSERT INTO platform\.access_requests/);
  assert.match(listRoute, /hasGovernanceWriteRole/);
  assert.match(workflowRoute, /createVerticalWorkflowRoute\(ACCESS_WORKFLOW\)/);
  assert.match(decisionRoute, /createVerticalDecisionRoute\(ACCESS_WORKFLOW\)/);
  // The access request's binding lives once in lib/verticals.ts.
  const verticals = read('../lib/verticals.ts');
  assert.match(verticals, /table: 'platform\.access_requests'/);
  assert.match(verticals, /subjectType: 'access\.request'/);
  assert.match(verticals, /stageKey === 'GRANTED' \? 'GRANTED' : 'SUBMITTED'/);
  // The shared factory carries the governed decision capture.
  const factory = read('../lib/vertical-workflow-route.ts');
  assert.match(factory, /recordCaseDecision/);
});

test('the Access Requests surface can file, review, approve and grant', () => {
  assert.match(client, /File request/);
  assert.match(client, /Assign reviewer/);
  assert.match(client, /Approve &amp; grant/);
  assert.match(client, /approveAndGrant/);
  assert.match(client, /WorkflowTraceModal/);
  assert.match(nav, /href: '\/access-requests'/);
});
