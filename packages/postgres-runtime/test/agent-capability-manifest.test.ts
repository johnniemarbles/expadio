import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCapabilityManifest } from '@expadio/capabilities';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresAgentCapabilityManifestRepository } from '../src/agent-capability-manifest.ts';

class Client implements PostgresClient {
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

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function row(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'SKILL',
    capability_key: 'source-verify',
    version: 2,
    state: 'PUBLISHED',
    scope_kind: 'PLATFORM',
    scope_key: null,
    tenant_id: null,
    owner_subject_id: 'platform-owner',
    instruction_reference: 'instruction://source-verify/2',
    instruction_digest: digest('a'),
    input_schema: {
      schemaReference: 'schema://source/input/2',
      schemaDigest: digest('b'),
    },
    output_schema: {
      schemaReference: 'schema://source/output/2',
      schemaDigest: digest('c'),
    },
    required_permission_keys: ['knowledge.read'],
    allowed_tool_keys: ['knowledge.search'],
    negative_constraint_keys: ['NO_DIRECT_MUTATION'],
    budget_policy_reference: 'budget://agent/default',
    max_steps: 8,
    max_cost_minor_units: 250,
    timeout_seconds: 90,
    stop_condition_keys: ['OBJECTIVE_MET'],
    escalation_policy_reference: 'escalation://human-review',
    skill_references: [],
    verified_at: new Date('2026-08-27T00:00:00.000Z'),
    effective_from: '2026-08-28T00:00:00.000Z',
    evidence_refs: ['verification://source-verify/2'],
    ...overrides,
  };
}

test('loads exact kind/key candidates through the RLS-bound table', async () => {
  const client = new Client();
  client.responses.push({ rows: [row()], rowCount: 1 });

  const manifests = await new PostgresAgentCapabilityManifestRepository(client)
    .findByKindAndKey('SKILL', 'source-verify');

  assert.deepEqual(client.calls[0]?.values, ['SKILL', 'source-verify']);
  assert.match(client.calls[0]?.text ?? '', /platform\.agent_capability_manifests/);
  assert.match(client.calls[0]?.text ?? '', /WHERE kind = \$1/);
  assert.match(client.calls[0]?.text ?? '', /capability_key = \$2/);
  assert.equal(manifests.length, 1);
  assert.deepEqual(manifests[0]?.scope, { kind: 'PLATFORM' });
  assert.equal(manifests[0]?.verifiedAt, '2026-08-27T00:00:00.000Z');
  assert.equal(manifests[0]?.effectiveFrom, '2026-08-28T00:00:00.000Z');
});

test('maps vertical and tenant scopes without widening tenant ownership', async () => {
  const tenantId = '42000000-0000-0000-0000-000000000001';
  const client = new Client();
  client.responses.push({
    rows: [
      row({ scope_kind: 'VERTICAL', scope_key: 'dentex' }),
      row({ scope_kind: 'TENANT', scope_key: tenantId, tenant_id: tenantId }),
    ],
    rowCount: 2,
  });

  const manifests = await new PostgresAgentCapabilityManifestRepository(client)
    .findByKindAndKey('SKILL', 'source-verify');

  assert.deepEqual(manifests.map((manifest) => manifest.scope), [
    { kind: 'VERTICAL', verticalKey: 'dentex' },
    { kind: 'TENANT', tenantId },
  ]);
  assert.notEqual(
    manifests[0]?.requiredPermissionKeys,
    manifests[1]?.requiredPermissionKeys,
  );
});

test('fails closed when persisted scope columns are inconsistent', async () => {
  const client = new Client();
  client.responses.push({
    rows: [row({
      scope_kind: 'TENANT',
      scope_key: '42000000-0000-0000-0000-000000000001',
      tenant_id: '42000000-0000-0000-0000-000000000002',
    })],
    rowCount: 1,
  });

  await assert.rejects(
    new PostgresAgentCapabilityManifestRepository(client)
      .findByKindAndKey('SKILL', 'source-verify'),
    /AGENT_CAPABILITY_TENANT_SCOPE_INVALID/,
  );
});
