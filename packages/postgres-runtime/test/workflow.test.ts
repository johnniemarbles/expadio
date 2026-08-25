import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresWorkflowBlueprintRepository } from '../src/workflow.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import type { WorkflowBlueprintDefinition, WorkflowStageDefinition } from '@expadio/workflow';

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

const stage: WorkflowStageDefinition = {
  stageKey: 'qualification',
  label: 'Qualification',
  sequence: 0,
  kind: 'QUALIFICATION',
  isMandatory: true,
  canBeDeactivated: false,
  isParallel: false,
  requiredParticipantKeys: ['reviewer'],
  decisionRequired: false,
  decisionOutcomes: [],
  entryConditions: [],
  exitConditions: [],
  blockingRequirementKeys: [],
  autoAdvance: false,
  onReject: 'RETURN',
};

const tenantDefinition: WorkflowBlueprintDefinition = {
  blueprintKey: 'partner-onboarding',
  version: 2,
  label: 'Tenant partner onboarding',
  workTypeKey: 'partner-onboarding',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  source: 'TENANT_CUSTOMIZED',
  parent: { blueprintKey: 'partner-onboarding', version: 1 },
  state: 'ACTIVE',
  allowsStageAddition: true,
  allowsStageReorder: false,
  allowsStageDeactivation: false,
  minimumRequiredStageKeys: ['qualification'],
  stages: [stage],
  publishedBySubjectId: 'subject-1',
  publishedAt: '2026-08-25T06:00:00.000Z',
};

const tenantRow = {
  tenant_id: tenantDefinition.tenantId,
  blueprint_key: tenantDefinition.blueprintKey,
  version: tenantDefinition.version,
  label: tenantDefinition.label,
  work_type_key: tenantDefinition.workTypeKey,
  source: tenantDefinition.source,
  parent_blueprint_key: tenantDefinition.parent?.blueprintKey ?? null,
  parent_blueprint_version: tenantDefinition.parent?.version ?? null,
  state: tenantDefinition.state,
  allows_stage_addition: tenantDefinition.allowsStageAddition,
  allows_stage_reorder: tenantDefinition.allowsStageReorder,
  allows_stage_deactivation: tenantDefinition.allowsStageDeactivation,
  minimum_required_stage_keys: tenantDefinition.minimumRequiredStageKeys,
  stages: tenantDefinition.stages,
  published_by_subject_id: tenantDefinition.publishedBySubjectId ?? null,
  published_at: tenantDefinition.publishedAt ?? null,
};

test('create persists the complete blueprint snapshot and maps RETURNING row', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [tenantRow], rowCount: 1 });

  const result = await new PostgresWorkflowBlueprintRepository(client).create(tenantDefinition);

  assert.deepEqual(result, tenantDefinition);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.workflow_blueprints/);
  assert.match(client.calls[0]?.text ?? '', /RETURNING tenant_id, blueprint_key/);
  assert.equal(client.calls[0]?.values[0], tenantDefinition.tenantId);
  assert.equal(client.calls[0]?.values[1], tenantDefinition.blueprintKey);
  assert.equal(client.calls[0]?.values[5], 'TENANT_CUSTOMIZED');
  assert.equal(client.calls[0]?.values[13], JSON.stringify(tenantDefinition.stages));
});

test('findByIdentity binds tenant scope explicitly and maps a tenant row', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [tenantRow], rowCount: 1 });

  const result = await new PostgresWorkflowBlueprintRepository(client).findByIdentity({
    scope: { type: 'TENANT', tenantId: tenantDefinition.tenantId! },
    identity: { blueprintKey: tenantDefinition.blueprintKey, version: 2 },
  });

  assert.deepEqual(result, tenantDefinition);
  assert.deepEqual(client.calls[0]?.values, [
    tenantDefinition.tenantId,
    tenantDefinition.blueprintKey,
    2,
  ]);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
});

test('findByIdentity uses NULL tenant scope for a platform blueprint', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      ...tenantRow,
      tenant_id: null,
      source: 'PLATFORM',
      parent_blueprint_key: null,
      parent_blueprint_version: null,
      published_by_subject_id: null,
      published_at: null,
    }],
    rowCount: 1,
  });

  const result = await new PostgresWorkflowBlueprintRepository(client).findByIdentity({
    scope: { type: 'PLATFORM' },
    identity: { blueprintKey: tenantDefinition.blueprintKey, version: 2 },
  });

  assert.equal(result?.source, 'PLATFORM');
  assert.equal(result?.tenantId, undefined);
  assert.equal(result?.parent, undefined);
  assert.deepEqual(client.calls[0]?.values, [null, tenantDefinition.blueprintKey, 2]);
  assert.match(client.calls[0]?.text ?? '', /\$1::uuid IS NULL AND tenant_id IS NULL/);
});

test('findByIdentity returns null when the scoped identity is absent', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresWorkflowBlueprintRepository(client).findByIdentity({
    scope: { type: 'TENANT', tenantId: tenantDefinition.tenantId! },
    identity: { blueprintKey: 'missing', version: 1 },
  });

  assert.equal(result, null);
});

test('listVersions preserves descending database version order', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [tenantRow, { ...tenantRow, version: 1, state: 'SUPERSEDED' }],
    rowCount: 2,
  });

  const result = await new PostgresWorkflowBlueprintRepository(client).listVersions({
    scope: { type: 'TENANT', tenantId: tenantDefinition.tenantId! },
    blueprintKey: tenantDefinition.blueprintKey,
  });

  assert.deepEqual(result.map((item) => item.version), [2, 1]);
  assert.deepEqual(client.calls[0]?.values, [tenantDefinition.tenantId, tenantDefinition.blueprintKey]);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY version DESC/);
});

test('listActiveForWorkType returns only ACTIVE candidates within the requested scope', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [
      tenantRow,
      { ...tenantRow, blueprint_key: 'partner-onboarding-alt', version: 1 },
    ],
    rowCount: 2,
  });

  const result = await new PostgresWorkflowBlueprintRepository(client).listActiveForWorkType({
    scope: { type: 'TENANT', tenantId: tenantDefinition.tenantId! },
    workTypeKey: tenantDefinition.workTypeKey,
  });

  assert.deepEqual(result.map((item) => item.blueprintKey), [
    'partner-onboarding',
    'partner-onboarding-alt',
  ]);
  assert.deepEqual(client.calls[0]?.values, [tenantDefinition.tenantId, tenantDefinition.workTypeKey]);
  assert.match(client.calls[0]?.text ?? '', /work_type_key = \$2/);
  assert.match(client.calls[0]?.text ?? '', /state = 'ACTIVE'/);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY version DESC, blueprint_key ASC/);
});
