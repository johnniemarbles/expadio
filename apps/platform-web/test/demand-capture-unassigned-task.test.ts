import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const routing = read('../../brand-web/lib/demand-capture-routing.ts');
const materializer = read('../lib/demand-capture-governed-actions.ts');
const worker = read('../lib/domain-event-action-worker.ts');

test('Brand routing emits an immutable Domain Event instead of creating tasks directly', () => {
  assert.match(routing, /appendDomainEventWithOutbox/);
  assert.match(routing, /LeadCapture\.RoutingUnassigned/);
  assert.match(routing, /aggregateType: 'lead\.capture'/);
  assert.match(routing, /causationId: assignmentEventId/);
  assert.doesNotMatch(routing, /operational_tasks/);
  assert.doesNotMatch(routing, /createOperationalTaskForGovernedAction/);
});

test('Demand Capture materializer produces a shared CREATE_TASK intent only while Lead Management is active', () => {
  assert.match(materializer, /loadTenantProductModule/);
  assert.match(materializer, /moduleKey: 'lead-management'/);
  assert.match(materializer, /availability !== 'ACTIVE'/);
  assert.match(materializer, /executorClass: 'CREATE_TASK'/);
  assert.match(materializer, /lead\.capture\.routing\.resolve_unassigned/);
  assert.match(materializer, /persistGovernedActionIntent/);
  assert.doesNotMatch(materializer, /INSERT INTO platform\.operational_tasks/);
});

test('shared Domain Event worker owns Demand Capture task execution', () => {
  assert.match(worker, /materializeDemandCaptureGovernedActionsForEvent/);
  assert.match(worker, /aggregateType === 'lead\.capture'/);
  assert.match(worker, /executeGovernedCreateTaskAction/);
  assert.match(worker, /executorClass === 'CREATE_TASK'/);
  assert.doesNotMatch(worker, /lead_capture_assignment_events/);
});
