import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listRoute = readFileSync(
  new URL('../app/api/governance/domain-events/route.ts', import.meta.url),
  'utf8',
);
const requeueRoute = readFileSync(
  new URL('../app/api/governance/domain-events/[id]/requeue/route.ts', import.meta.url),
  'utf8',
);
const operations = readFileSync(
  new URL('../lib/domain-event-operations.ts', import.meta.url),
  'utf8',
);
const client = readFileSync(
  new URL('../app/(shell)/governance/domain-events/DomainEventOperationsClient.tsx', import.meta.url),
  'utf8',
);
const tools = readFileSync(
  new URL('../app/(shell)/governance/GovernanceToolsDirectory.tsx', import.meta.url),
  'utf8',
);

test('Domain Event operations are tenant-RLS governance reads', () => {
  assert.match(listRoute, /resolveRequestContext/);
  assert.match(listRoute, /withTenantTransaction/);
  assert.match(operations, /platform\.domain_event_outbox/);
  assert.match(operations, /platform\.domain_events/);
});

test('dead-letter requeue is a governed step-up write with immutable evidence', () => {
  assert.match(requeueRoute, /requireStepUp/);
  assert.match(requeueRoute, /hasGovernanceWriteRole/);
  assert.match(requeueRoute, /resolveGoverningRole/);
  assert.match(requeueRoute, /withTenantTransaction/);
  assert.match(operations, /status !== 'DEAD'/);
  assert.match(operations, /platform\.domain_event_outbox_requeue_events/);
  assert.match(operations, /attempts = 0/);
});

test('Governance exposes dead-letter visibility and requeue only for DEAD rows', () => {
  assert.match(tools, /\/governance\/domain-events/);
  assert.match(client, /Domain Event delivery/);
  assert.match(client, /item\.status === 'DEAD'/);
  assert.match(client, /Requeue/);
  assert.match(client, /x-expadio-reauth-at/);
});
