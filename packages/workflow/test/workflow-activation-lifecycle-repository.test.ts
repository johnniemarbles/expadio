import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationLifecycleEvent,
  WorkflowActivationLifecycleRepository,
  WorkflowActivationLifecycleState,
} from '../src/index.ts';

const event: WorkflowActivationLifecycleEvent = {
  eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  fromState: 'ACTIVE',
  toState: 'SUSPENDED',
  action: 'SUSPEND',
  affectedRightsGrantIds: ['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'],
  monitoringTriggerKey: 'trade-control.status-changed',
  performedBySubjectId: 'compliance-officer-1',
  performedAt: '2026-08-25T14:00:00.000Z',
  reason: 'Standing gate failed.',
  evidenceRefs: ['monitoring-check:1'],
};

class MemoryRepository implements WorkflowActivationLifecycleRepository {
  readonly events = new Map<string, WorkflowActivationLifecycleEvent>();
  readonly states = new Map<string, WorkflowActivationLifecycleState>([
    [`${event.tenantId}:${event.activationId}`, 'ACTIVE'],
  ]);

  async findEvent(input: { tenantId: string; eventId: string }) {
    return this.events.get(`${input.tenantId}:${input.eventId}`) ?? null;
  }

  async currentState(input: { tenantId: string; activationId: string }) {
    return this.states.get(`${input.tenantId}:${input.activationId}`) ?? null;
  }

  async append(input: WorkflowActivationLifecycleEvent) {
    const eventKey = `${input.tenantId}:${input.eventId}`;
    const existing = this.events.get(eventKey);
    if (existing !== undefined) {
      return JSON.stringify(existing) === JSON.stringify(input)
        ? { status: 'ALREADY_RECORDED' as const, event: existing }
        : { status: 'EVENT_CONFLICT' as const, existing };
    }

    const stateKey = `${input.tenantId}:${input.activationId}`;
    const currentState = this.states.get(stateKey);
    if (currentState !== input.fromState) {
      return {
        status: 'STATE_CONFLICT' as const,
        currentState: currentState ?? 'REVOKED',
      };
    }

    this.events.set(eventKey, structuredClone(input));
    this.states.set(stateKey, input.toState);
    return { status: 'COMMITTED' as const, event: input };
  }
}

test('appends a transition only from the current projected state', async () => {
  const repository = new MemoryRepository();
  const result = await repository.append(event);
  assert.equal(result.status, 'COMMITTED');
  assert.equal(await repository.currentState({
    tenantId: event.tenantId,
    activationId: event.activationId,
  }), 'SUSPENDED');
});

test('maps exact event retries without advancing state twice', async () => {
  const repository = new MemoryRepository();
  await repository.append(event);
  const result = await repository.append(structuredClone(event));
  assert.equal(result.status, 'ALREADY_RECORDED');
});

test('rejects changed content using the same event identity', async () => {
  const repository = new MemoryRepository();
  await repository.append(event);
  const result = await repository.append({ ...event, reason: 'Changed.' });
  assert.equal(result.status, 'EVENT_CONFLICT');
});

test('rejects a stale expected state', async () => {
  const repository = new MemoryRepository();
  await repository.append(event);
  const result = await repository.append({
    ...event,
    eventId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  });
  assert.equal(result.status, 'STATE_CONFLICT');
  assert.equal(result.currentState, 'SUSPENDED');
});

test('event and state lookups are tenant scoped', async () => {
  const repository = new MemoryRepository();
  await repository.append(event);
  assert.equal(await repository.findEvent({
    tenantId: '11111111-1111-1111-1111-111111111111',
    eventId: event.eventId,
  }), null);
});
