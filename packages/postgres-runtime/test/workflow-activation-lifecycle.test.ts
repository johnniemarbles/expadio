import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationLifecycleEvent,
} from '@expadio/workflow';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresWorkflowActivationLifecycleRepository } from '../src/workflow-activation-lifecycle.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const event: WorkflowActivationLifecycleEvent = {
  eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  fromState: 'ACTIVE',
  toState: 'SUSPENDED',
  action: 'SUSPEND',
  affectedRightsGrantIds: ['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'],
  monitoringTriggerKey: 'standing-control:insurance',
  sourceVerificationId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  performedBySubjectId: 'monitor-1',
  performedAt: '2026-08-25T14:30:00.000Z',
  reason: 'Insurance evidence expired.',
  evidenceRefs: ['monitoring-snapshot:1'],
};

const row = {
  event_id: event.eventId,
  tenant_id: event.tenantId,
  instance_id: event.instanceId,
  activation_id: event.activationId,
  from_state: event.fromState,
  to_state: event.toState,
  action: event.action,
  affected_rights_grant_ids: event.affectedRightsGrantIds,
  monitoring_trigger_key: event.monitoringTriggerKey,
  source_verification_id: event.sourceVerificationId,
  performed_by_subject_id: event.performedBySubjectId,
  performed_at: event.performedAt,
  reason: event.reason,
  evidence_refs: event.evidenceRefs,
};

test('findEvent resolves one tenant-scoped lifecycle event', async () => {
  const client = new ScriptedClient();
  client.steps.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationLifecycleRepository(client)
    .findEvent({ tenantId: event.tenantId, eventId: event.eventId });

  assert.deepEqual(result, event);
  assert.deepEqual(client.calls[0]?.values, [event.tenantId, event.eventId]);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[0]?.text ?? '', /event_id = \$2::uuid/);
});

test('currentState derives the latest tenant-scoped lifecycle state', async () => {
  const client = new ScriptedClient();
  client.steps.push({ rows: [{ state: 'SUSPENDED' }], rowCount: 1 });

  const result = await new PostgresWorkflowActivationLifecycleRepository(client)
    .currentState({ tenantId: event.tenantId, activationId: event.activationId });

  assert.equal(result, 'SUSPENDED');
  assert.deepEqual(client.calls[0]?.values, [event.tenantId, event.activationId]);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY performed_at DESC, event_id DESC/);
  assert.match(client.calls[0]?.text ?? '', /workflow_activation_verifications/);
  assert.match(client.calls[0]?.text ?? '', /state = 'VERIFIED'/);
});

test('append returns COMMITTED for a new lifecycle event', async () => {
  const client = new ScriptedClient();
  client.steps.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationLifecycleRepository(client)
    .append(event);

  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(result.event, event);
  assert.deepEqual(client.calls[0]?.values[7], event.affectedRightsGrantIds);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT DO NOTHING/);
});

test('append maps an exact retry to ALREADY_RECORDED', async () => {
  const client = new ScriptedClient();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationLifecycleRepository(client)
    .append(event);

  assert.equal(result.status, 'ALREADY_RECORDED');
  assert.equal(client.calls.length, 2);
});

test('append maps changed immutable content to EVENT_CONFLICT', async () => {
  const client = new ScriptedClient();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({
    rows: [{ ...row, reason: 'A different immutable reason.' }],
    rowCount: 1,
  });

  const result = await new PostgresWorkflowActivationLifecycleRepository(client)
    .append(event);

  assert.equal(result.status, 'EVENT_CONFLICT');
  assert.equal(result.existing.reason, 'A different immutable reason.');
});

test('append maps a stale-state constraint failure to STATE_CONFLICT', async () => {
  const client = new ScriptedClient();
  client.steps.push(Object.assign(new Error('stale state'), { code: '23514' }));
  client.steps.push({ rows: [{ state: 'SUSPENDED' }], rowCount: 1 });

  const result = await new PostgresWorkflowActivationLifecycleRepository(client)
    .append(event);

  assert.deepEqual(result, { status: 'STATE_CONFLICT', currentState: 'SUSPENDED' });
  assert.equal(client.calls.length, 2);
});

test('append preserves non-stale constraint failures', async () => {
  const client = new ScriptedClient();
  const databaseError = Object.assign(new Error('invalid lifecycle event'), {
    code: '23514',
  });
  client.steps.push(databaseError);
  client.steps.push({ rows: [{ state: 'ACTIVE' }], rowCount: 1 });

  await assert.rejects(
    new PostgresWorkflowActivationLifecycleRepository(client).append(event),
    (error: unknown) => error === databaseError,
  );
});
