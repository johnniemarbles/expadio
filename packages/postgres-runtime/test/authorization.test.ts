import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresAuthorizationPolicyRepository } from '../src/authorization.ts';
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

const context = {
  subjectId: 'user-123',
  actorKind: 'user' as const,
  issuer: 'oidc:test',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-1111-1111-111111111111',
};

test('maps role capabilities and restrictions into the pure authorization contract', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 2,
    rows: [
      {
        assignment_id: 'assignment-1',
        organization_id: null,
        role_key: 'CASE_MANAGER',
        action_organization_ids: ['11111111-1111-1111-1111-111111111111'],
        action_operating_unit_ids: null,
        action_resource_ids: null,
        visibility_organization_ids: null,
        visibility_operating_unit_ids: null,
        visibility_resource_ids: null,
        clearances: ['confidential'],
        sensitive_compartments: [],
        action: 'read',
        resource_type: 'case',
        blocked_states: [],
      },
      {
        assignment_id: 'assignment-1',
        organization_id: null,
        role_key: 'CASE_MANAGER',
        action_organization_ids: ['11111111-1111-1111-1111-111111111111'],
        action_operating_unit_ids: null,
        action_resource_ids: null,
        visibility_organization_ids: null,
        visibility_operating_unit_ids: null,
        visibility_resource_ids: null,
        clearances: ['confidential'],
        sensitive_compartments: [],
        action: 'close',
        resource_type: 'case',
        blocked_states: ['CLOSED'],
      },
    ],
  });
  client.responses.push({
    rowCount: 1,
    rows: [{
      restriction_key: 'CASE-7-FROZEN',
      action: 'close',
      resource_type: 'case',
      resource_id: 'case-7',
      reason: 'Legal hold.',
    }],
  });

  const policy = await new PostgresAuthorizationPolicyRepository(client).loadPolicy(context);

  assert.deepEqual(policy.assignments, [{
    roleKey: 'CASE_MANAGER',
    capabilities: [
      { action: 'read', resourceType: 'case' },
      { action: 'close', resourceType: 'case', blockedStates: ['CLOSED'] },
    ],
    actionScope: {
      tenantId: context.tenantId,
      organizationIds: [context.organizationId],
    },
    clearances: ['confidential'],
    sensitiveCompartments: [],
  }]);
  assert.deepEqual(policy.restrictions, [{
    key: 'CASE-7-FROZEN',
    action: 'close',
    resourceType: 'case',
    resourceId: 'case-7',
    reason: 'Legal hold.',
  }]);
  assert.deepEqual(client.calls[0]?.values, [
    context.tenantId,
    context.subjectId,
    context.organizationId,
  ]);
  assert.deepEqual(client.calls[1]?.values, [context.tenantId, context.subjectId]);
});

test('organization-specific assignment cannot broaden itself to another organization', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      assignment_id: 'assignment-2',
      organization_id: context.organizationId,
      role_key: 'ORG_OPERATOR',
      action_organization_ids: ['22222222-2222-2222-2222-222222222222'],
      action_operating_unit_ids: null,
      action_resource_ids: null,
      visibility_organization_ids: null,
      visibility_operating_unit_ids: null,
      visibility_resource_ids: null,
      clearances: [],
      sensitive_compartments: [],
      action: 'update',
      resource_type: 'record',
      blocked_states: [],
    }],
  });
  client.responses.push({ rowCount: 0, rows: [] });

  const policy = await new PostgresAuthorizationPolicyRepository(client).loadPolicy(context);

  assert.deepEqual(policy.assignments[0]?.actionScope.organizationIds, []);
  assert.deepEqual(policy.assignments[0]?.visibilityScope?.organizationIds, [context.organizationId]);
});
