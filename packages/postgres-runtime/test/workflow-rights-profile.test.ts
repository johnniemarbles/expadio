import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresWorkflowRightsProfileProvider } from '../src/workflow-rights-profile.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const row = {
  tenant_id: '97979797-9797-9797-9797-979797979797',
  profile_key: 'standard-partner',
  version: 2,
  label: 'Tenant standard partner',
  right_types: ['OPERATE', 'SELL'],
  maximum_scope: { channelKeys: ['direct'] },
  permits_exclusivity: false,
  permits_delegation: true,
  permits_sub_appointment: false,
  default_duration: 'P1Y',
  renewal_model: 'RENEWABLE',
};

test('resolve prefers exact tenant profile over platform fallback', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const profile = await new PostgresWorkflowRightsProfileProvider(client).resolve({
    tenantId: row.tenant_id,
    profileKey: ' standard-partner ',
    version: 2,
  });

  assert.deepEqual(profile, {
    profileKey: 'standard-partner',
    version: 2,
    label: 'Tenant standard partner',
    rightTypes: ['OPERATE', 'SELL'],
    maximumScope: { channelKeys: ['direct'] },
    permitsExclusivity: false,
    permitsDelegation: true,
    permitsSubAppointment: false,
    defaultDuration: 'P1Y',
    renewalModel: 'RENEWABLE',
  });
  assert.deepEqual(client.calls[0]?.values, [row.tenant_id, 'standard-partner', 2]);
  assert.match(client.calls[0]?.text ?? '', /\$1::uuid = platform\.current_tenant_id\(\)/);
  assert.match(client.calls[0]?.text ?? '', /CASE WHEN tenant_id = \$1::uuid THEN 0 ELSE 1 END/);
});

test('resolve maps a platform fallback without leaking storage scope', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      ...row,
      tenant_id: null,
      maximum_scope: null,
      default_duration: null,
      renewal_model: null,
    }],
    rowCount: 1,
  });

  const profile = await new PostgresWorkflowRightsProfileProvider(client).resolve({
    tenantId: '97979797-9797-9797-9797-979797979797',
    profileKey: 'standard-partner',
    version: 2,
  });

  assert.equal(profile?.profileKey, 'standard-partner');
  assert.equal(profile?.maximumScope, undefined);
  assert.equal(profile?.defaultDuration, undefined);
  assert.equal(profile?.renewalModel, undefined);
});

test('resolve returns null when no exact profile version exists', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const profile = await new PostgresWorkflowRightsProfileProvider(client).resolve({
    tenantId: '97979797-9797-9797-9797-979797979797',
    profileKey: 'missing',
    version: 1,
  });

  assert.equal(profile, null);
});
