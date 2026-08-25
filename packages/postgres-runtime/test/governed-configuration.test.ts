import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  maximumNumberOverride,
  PostgresConfigurationSettingDefinitionRepository,
  PostgresConfigurationValueCandidateRepository,
} from '../src/governed-configuration.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
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

test('loads the definition effective at the requested instant', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{
      setting_key: 'delivery.daily_limit',
      override_mode: 'BOUNDED',
      allowed_override_levels: ['TENANT'],
    }],
    rowCount: 1,
  });
  const repository = new PostgresConfigurationSettingDefinitionRepository(
    client,
    new Map([['delivery.daily_limit', maximumNumberOverride]]),
  );

  const result = await repository.findDefinition(
    'delivery.daily_limit',
    '2026-08-25T12:00:00.000Z',
  );

  assert.equal(result?.settingKey, 'delivery.daily_limit');
  assert.equal(result?.validateOverride, maximumNumberOverride);
  assert.deepEqual(client.calls[0]?.values, [
    'delivery.daily_limit',
    '2026-08-25T12:00:00.000Z',
  ]);
  assert.match(client.calls[0]?.text ?? '', /effective_from <= \$2/);
});

test('fails closed when a bounded setting has no code validator', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{
      setting_key: 'delivery.daily_limit',
      override_mode: 'BOUNDED',
      allowed_override_levels: ['TENANT'],
    }],
    rowCount: 1,
  });

  await assert.rejects(
    () => new PostgresConfigurationSettingDefinitionRepository(client)
      .findDefinition('delivery.daily_limit', '2026-08-25T12:00:00.000Z'),
    /CONFIGURATION_BOUND_VALIDATOR_NOT_REGISTERED:delivery\.daily_limit/,
  );
});

test('loads candidates for only the exact context and effective window', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{
      value_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      level: 'TENANT',
      scope_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      record_version: 2,
      value: 500,
      effective_from: '2026-08-25T11:00:00.000Z',
      evidence_refs: ['ticket:123'],
    }],
    rowCount: 1,
  });
  const repository = new PostgresConfigurationValueCandidateRepository(client);

  const result = await repository.listCandidates({
    settingKey: 'delivery.daily_limit',
    context: {
      environmentKey: 'production',
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      workspaceId: 'workspace-1',
    },
    effectiveAt: '2026-08-25T12:00:00.000Z',
  });

  assert.deepEqual(result, [{
    level: 'TENANT',
    scopeId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    recordId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    version: 2,
    effectiveFrom: '2026-08-25T11:00:00.000Z',
    value: 500,
    evidenceRefs: ['ticket:123'],
  }]);
  assert.equal(
    client.calls[0]?.values[5],
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  );
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$6::uuid/);
  assert.match(client.calls[0]?.text ?? '', /effective_until IS NULL/);
});

test('numeric limit validator prevents lower scopes raising a parent ceiling', () => {
  const current = {
    level: 'PLATFORM' as const,
    recordId: 'parent',
    version: 1,
    effectiveFrom: '2026-08-25T11:00:00.000Z',
    value: 100,
    evidenceRefs: [],
  };
  assert.equal(maximumNumberOverride({
    current,
    candidate: { ...current, level: 'TENANT', recordId: 'child', value: 101 },
  }).allowed, false);
  assert.equal(maximumNumberOverride({
    current,
    candidate: { ...current, level: 'TENANT', recordId: 'child', value: 80 },
  }).allowed, true);
});
