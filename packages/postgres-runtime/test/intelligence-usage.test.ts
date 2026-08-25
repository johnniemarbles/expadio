import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  IntelligenceUsageEvent,
} from '@expadio/usage-metering';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  PostgresIntelligenceUsageRepository,
} from '../src/intelligence-usage.ts';

class Client implements PostgresClient {
  readonly calls: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const event: IntelligenceUsageEvent = {
  eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  organizationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  meter: 'AI_OUTPUT_TOKEN',
  quantity: 500,
  costMinorUnits: 30,
  currency: 'USD',
  capabilityKey: 'ai.generate',
  connectorKey: 'tenant-llm',
  providerKey: 'customer-provider',
  modelKey: 'model-1',
  providerCostOwnership: 'BYOK',
  workReference: 'ai-job://job-1',
  occurredAt: '2026-08-25T21:00:00.000Z',
  recordedAt: '2026-08-25T21:00:01.000Z',
  correlationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  evidenceRefs: ['provider-response://request-1'],
};

function row() {
  return {
    event_id: event.eventId,
    tenant_id: event.tenantId,
    organization_id: event.organizationId,
    meter: event.meter,
    quantity: String(event.quantity),
    cost_minor_units: String(event.costMinorUnits),
    currency: event.currency,
    capability_key: event.capabilityKey,
    connector_key: event.connectorKey,
    provider_key: event.providerKey,
    model_key: event.modelKey,
    provider_cost_ownership: event.providerCostOwnership,
    work_reference: event.workReference,
    occurred_at: event.occurredAt,
    recorded_at: event.recordedAt,
    correlation_id: event.correlationId,
    evidence_refs: event.evidenceRefs,
  };
}

test('records an immutable tenant-attributed usage event', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const result =
    await new PostgresIntelligenceUsageRepository(client).record(event);

  assert.equal(result.recorded, true);
  assert.match(
    client.calls[0]?.text ?? '',
    /INSERT INTO platform\.intelligence_usage_events/,
  );
  assert.equal(client.calls[0]?.values[2], event.organizationId);
  assert.equal(client.calls[0]?.values[11], 'BYOK');
});

test('treats an identical event retry as already recorded', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [row()], rowCount: 1 });

  const result =
    await new PostgresIntelligenceUsageRepository(client).record(event);

  assert.equal(result.recorded, false);
  assert.deepEqual(result.event, event);
});

test('loads an exact monthly scope position', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{ committed_cost_minor_units: '730' }],
    rowCount: 1,
  });

  const position =
    await new PostgresIntelligenceUsageRepository(client).monthlyPosition({
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      currency: 'usd',
      period: '2026-08',
    });

  assert.deepEqual(position, {
    tenantId: event.tenantId,
    organizationId: event.organizationId,
    currency: 'USD',
    period: '2026-08',
    committedCostMinorUnits: 730,
  });
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[0]?.text ?? '', /organization_id = \$2::uuid/);
  assert.deepEqual(client.calls[0]?.values, [
    event.tenantId,
    event.organizationId,
    'USD',
    '2026-08-01',
  ]);
});

test('rejects out-of-range database totals', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{
      committed_cost_minor_units: '9007199254740992',
    }],
    rowCount: 1,
  });

  await assert.rejects(
    () =>
      new PostgresIntelligenceUsageRepository(client).monthlyPosition({
        tenantId: event.tenantId,
        organizationId: null,
        currency: 'USD',
        period: '2026-08',
      }),
    /USAGE_POSITION_COST_OUT_OF_RANGE/,
  );
});
