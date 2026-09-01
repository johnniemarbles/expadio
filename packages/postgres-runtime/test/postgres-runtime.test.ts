import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityStateCommit } from '@expadio/capability-persistence';
import type { EffectiveContext, IdentityContext } from '@expadio/tenancy';
import {
  bindEffectiveContextToPostgres,
  PostgresCapabilityStateRepository,
  PostgresMembershipRepository,
  listActiveMembershipWorkspaces,
  withEffectiveContextTransaction,
  type PostgresClient,
  type PostgresPool,
  type SqlQueryResult,
} from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];
  released = false;
  failOn?: string;

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (this.failOn !== undefined && text.includes(this.failOn)) throw new Error('scripted failure');
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }

  release(): void {
    this.released = true;
  }
}

const identity: IdentityContext = { subjectId: 'subject-1', actorKind: 'user', issuer: 'oidc:test' };
const context: EffectiveContext = {
  subjectId: 'subject-1',
  actorKind: 'user',
  issuer: 'oidc:test',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-1111-1111-111111111111',
  workspaceId: '31111111-1111-1111-1111-111111111111',
};

test('membership repository calls only the bootstrap function and preserves ALL vs SELECTED scope', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 2,
    rows: [
      {
        tenant_id: 'tenant-a',
        organization_id: 'org-a',
        workspace_scope_mode: 'ALL',
        workspace_ids: null,
        operating_unit_scope_mode: 'SELECTED',
        operating_unit_ids: ['unit-1'],
      },
      {
        tenant_id: 'tenant-b',
        organization_id: 'org-b',
        workspace_scope_mode: 'SELECTED',
        workspace_ids: [],
        operating_unit_scope_mode: 'ALL',
        operating_unit_ids: null,
      },
    ],
  });

  const repository = new PostgresMembershipRepository(client);
  const memberships = await repository.listActiveMemberships(identity);

  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0]?.text ?? '', /active_memberships_for_subject/);
  assert.deepEqual(client.calls[0]?.values, ['subject-1', 'oidc:test']);
  assert.deepEqual(memberships, [
    { tenantId: 'tenant-a', organizationId: 'org-a', operatingUnitIds: ['unit-1'] },
    { tenantId: 'tenant-b', organizationId: 'org-b', workspaceIds: [] },
  ]);
});

test('database context uses parameterized set_config calls for verified settings', async () => {
  const client = new ScriptedClient();
  await bindEffectiveContextToPostgres(client, context);

  assert.ok(client.calls.length >= 4);
  for (const call of client.calls) {
    assert.equal(call.text, 'SELECT set_config($1, $2, true)');
  }
  assert.deepEqual(client.calls.map((call) => call.values[0]), [
    'app.tenant_id',
    'app.subject_id',
    'app.organization_id',
    'app.workspace_id',
  ]);
});

test('request transaction binds context before work then commits and releases', async () => {
  const client = new ScriptedClient();
  const pool: PostgresPool = { async connect() { return client; } };

  const result = await withEffectiveContextTransaction(pool, context, async (tx) => {
    await tx.query('SELECT business_work()');
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(client.calls[0]?.text, 'BEGIN');
  assert.match(client.calls[1]?.text ?? '', /set_config/);
  assert.equal(client.calls.at(-1)?.text, 'COMMIT');
  assert.equal(client.released, true);
});

test('request transaction rolls back and preserves original error', async () => {
  const client = new ScriptedClient();
  const pool: PostgresPool = { async connect() { return client; } };

  await assert.rejects(
    () => withEffectiveContextTransaction(pool, context, async () => {
      throw new Error('business failure');
    }),
    /business failure/,
  );

  assert.equal(client.calls.at(-1)?.text, 'ROLLBACK');
  assert.equal(client.released, true);
});

test('capability state repository maps snapshots and enforces optimistic mutation count', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      binding_id: 'binding-1',
      tenant_id: context.tenantId,
      state: 'ACTIVE',
      reason_key: null,
      blocking_step_key: null,
      blocking_bound_key: null,
      if_you_do_nothing: [],
      input_hash: 'a'.repeat(64),
      version: 2,
      resolved_at: '2026-08-25T00:00:00.000Z',
    }],
  });

  const repository = new PostgresCapabilityStateRepository(client);
  const snapshot = await repository.load(context.tenantId, 'binding-1');
  assert.equal(snapshot?.version, 2);
  assert.equal(snapshot?.resolvedAt.toISOString(), '2026-08-25T00:00:00.000Z');

  client.responses.push({ rowCount: 0, rows: [] });
  const commit: CapabilityStateCommit = {
    expectedVersion: 2,
    snapshot: {
      bindingId: 'binding-1',
      tenantId: context.tenantId,
      state: 'DEGRADED',
      reasonKey: 'PARTIAL_PROOFS',
      blockingStepKey: 'COMPLETE_PROOFS',
      blockingBoundKey: null,
      ifYouDoNothing: ['Complete proofs'],
      inputHash: 'b'.repeat(64),
      version: 3,
      resolvedAt: new Date('2026-08-25T01:00:00.000Z'),
    },
    event: null,
  };

  await assert.rejects(() => repository.commit(commit), /CAPABILITY_STATE_CONCURRENCY_CONFLICT/);
});

test('capability state commit appends event only after successful snapshot mutation', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rowCount: 1, rows: [] }, { rowCount: 1, rows: [] });
  const repository = new PostgresCapabilityStateRepository(client);

  await repository.commit({
    expectedVersion: null,
    snapshot: {
      bindingId: 'binding-1',
      tenantId: context.tenantId,
      state: 'ACTIVE',
      reasonKey: null,
      blockingStepKey: null,
      blockingBoundKey: null,
      ifYouDoNothing: [],
      inputHash: 'c'.repeat(64),
      version: 1,
      resolvedAt: new Date('2026-08-25T00:00:00.000Z'),
    },
    event: {
      bindingId: 'binding-1',
      tenantId: context.tenantId,
      fromState: null,
      toState: 'ACTIVE',
      reasonKey: null,
      inputHash: 'c'.repeat(64),
      occurredAt: new Date('2026-08-25T00:00:00.000Z'),
    },
  });

  assert.equal(client.calls.length, 2);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.capability_state/);
  assert.match(client.calls[1]?.text ?? '', /INSERT INTO platform\.capability_state_events/);
});


test('workspace discovery keeps verified bootstrap identity on one transaction', async () => {
  const client = new ScriptedClient();
  client.responses.push(
    { rows: [], rowCount: null },
    { rows: [], rowCount: 1 },
    {
      rows: [{
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        organization_id: '11111111-1111-1111-1111-111111111111',
      }],
      rowCount: 1,
    },
    {
      rows: [{
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        tenant_name: 'Tenant A',
        organization_id: '11111111-1111-1111-1111-111111111111',
        organization_name: 'Org A',
      }],
      rowCount: 1,
    },
    { rows: [], rowCount: null },
  );
  const pool = { async connect() { return client; } };

  const workspaces = await listActiveMembershipWorkspaces(pool, identity);

  assert.deepEqual(workspaces, [{
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenantName: 'Tenant A',
    organizationId: '11111111-1111-1111-1111-111111111111',
    organizationName: 'Org A',
  }]);
  assert.equal(client.calls[0]?.text, 'BEGIN');
  assert.match(client.calls[1]?.text ?? '', /app\.subject_id/);
  assert.deepEqual(client.calls[1]?.values, ['subject-1', 'oidc:test']);
  assert.match(client.calls[2]?.text ?? '', /active_memberships_for_subject/);
  assert.match(client.calls[3]?.text ?? '', /FROM platform\.tenants/);
  assert.equal(client.calls.at(-1)?.text, 'COMMIT');
  assert.equal(client.released, true);
});
