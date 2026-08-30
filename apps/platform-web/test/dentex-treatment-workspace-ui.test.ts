import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const client = read('../app/(shell)/dentex/treatments/[id]/TreatmentWorkspaceClient.tsx');
const readinessRoute = read('../app/api/dentex/treatments/[id]/readiness/route.ts');
const readiness = read('../lib/dentex-treatment-readiness.ts');
const crm = read('../app/(shell)/crm/CrmClient.tsx');

test('DENTEX Treatment workspace exposes the planned tabbed product surface', () => {
  for (const label of [
    'Overview',
    'Clinical',
    'Care Plan',
    'Workflow',
    'Documents',
    'Communications',
    'Activity',
    'Audit',
  ]) {
    assert.match(client, new RegExp(label));
  }
});

test('Treatment readiness is generated from executable Pack semantics and workflow descriptors', () => {
  assert.match(readiness, /resolveCaseStageSemantics/);
  assert.match(readiness, /evaluateCrmCaseSemanticTransition/);
  assert.match(readiness, /describeWorkflow/);
  assert.match(readiness, /requiredRelationships/);
  assert.match(readiness, /requiredAttributeKeys/);
  assert.match(readiness, /requiredDecisionOutcomes/);
  assert.match(readinessRoute, /loadDentexTreatmentReadiness/);
});

test('workspace actions reuse governed workflow APIs', () => {
  assert.match(client, /\/workflow\/participants/);
  assert.match(client, /\/workflow\/decision/);
  assert.match(client, /expectedRevision/);
  assert.match(client, /toStageKey/);
  assert.match(client, /Record approval/);
  assert.match(client, /Assign me/);
});

test('DENTEX case list deep-links into the Treatment workspace only for the DENTEX vertical', () => {
  assert.match(crm, /verticalKey === "dentex"/);
  assert.match(crm, /\/dentex\/treatments\//);
  assert.match(crm, /Open the DENTEX Treatment workspace/);
});

test('unfinished capabilities are represented as truthful empty states, not fake data', () => {
  assert.match(client, /Clinical findings and notes are not yet attached/);
  assert.match(client, /Treatment-specific document attachment is not wired yet/);
  assert.match(client, /No Treatment communication timeline is projected yet/);
  assert.match(client, /workspace does not fabricate an audit log/);
});
