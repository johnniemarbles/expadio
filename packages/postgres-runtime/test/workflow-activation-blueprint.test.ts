import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresWorkflowActivationBlueprintProvider } from '../src/workflow-activation-blueprint.ts';

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
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  blueprint_key: 'partner-activation',
  version: 2,
  label: 'Tenant partner activation',
  work_type_key: 'partner-onboarding',
  provisioning_model: 'SCOPED_WORKSPACE',
  steps: [{
    stepKey: 'create-workspace',
    label: 'Create workspace',
    sequence: 0,
    requiredBeforeActive: true,
    actionKey: 'workspace.create',
    parameters: { scope: 'partner' },
  }],
} as const;

test('resolve prefers the exact tenant activation blueprint', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const blueprint = await new PostgresWorkflowActivationBlueprintProvider(client)
    .resolve({
      tenantId: row.tenant_id,
      blueprintKey: ' partner-activation ',
      version: 2,
    });

  assert.deepEqual(blueprint, {
    blueprintKey: row.blueprint_key,
    version: row.version,
    label: row.label,
    workTypeKey: row.work_type_key,
    provisioningModel: row.provisioning_model,
    steps: row.steps,
  });
  assert.deepEqual(client.calls[0]?.values, [
    row.tenant_id,
    row.blueprint_key,
    row.version,
  ]);
  assert.match(
    client.calls[0]?.text ?? '',
    /\$1::uuid = platform\.current_tenant_id\(\)/,
  );
  assert.match(
    client.calls[0]?.text ?? '',
    /CASE WHEN tenant_id = \$1::uuid THEN 0 ELSE 1 END/,
  );
});

test('resolve maps a platform fallback without exposing storage scope', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{ ...row, tenant_id: null }],
    rowCount: 1,
  });

  const blueprint = await new PostgresWorkflowActivationBlueprintProvider(client)
    .resolve({
      tenantId: row.tenant_id,
      blueprintKey: row.blueprint_key,
      version: row.version,
    });

  assert.equal(blueprint?.blueprintKey, row.blueprint_key);
  assert.equal('tenantId' in (blueprint ?? {}), false);
});

test('resolve returns null when no exact version exists', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const blueprint = await new PostgresWorkflowActivationBlueprintProvider(client)
    .resolve({
      tenantId: row.tenant_id,
      blueprintKey: 'missing',
      version: 1,
    });

  assert.equal(blueprint, null);
});
