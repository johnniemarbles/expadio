import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const trace = readFileSync(
  new URL('../lib/execution-trace.ts', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../app/api/governance/execution-traces/[eventId]/route.ts', import.meta.url),
  'utf8',
);
const operations = readFileSync(
  new URL('../app/(shell)/governance/domain-events/DomainEventOperationsClient.tsx', import.meta.url),
  'utf8',
);

test('execution trace is a read model over authoritative execution evidence', () => {
  assert.match(trace, /platform\.domain_events/);
  assert.match(trace, /platform\.domain_event_outbox/);
  assert.match(trace, /platform\.governed_action_intents/);
  assert.match(trace, /platform\.governed_action_execution_attempts/);
  assert.match(trace, /platform\.scheduled_governed_actions/);
  assert.match(trace, /platform\.operational_tasks/);
  assert.match(trace, /platform\.communication_deliveries/);
  assert.match(trace, /platform\.communication_provider_attempts/);
  assert.doesNotMatch(trace, /INSERT INTO/);
  assert.doesNotMatch(trace, /UPDATE platform/);
});

test('execution trace API is authenticated and tenant-RLS scoped', () => {
  assert.match(route, /resolveRequestContext/);
  assert.match(route, /withTenantTransaction/);
  assert.match(route, /tenantId: context\.tenantId/);
  assert.match(route, /loadExecutionTraceForEvent/);
});

test('Domain Event operations deep-link into causal execution evidence', () => {
  assert.match(operations, /\/governance\/execution-traces\//);
  assert.match(operations, />\s*Trace\s*</);
});
