import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresWorkflowRightsGrantRepository } from '../src/workflow-rights.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import type { WorkflowRightsGrant } from '@expadio/workflow';

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

const grant: WorkflowRightsGrant = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  grantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  beneficiaryOrganizationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  profileKey: 'territory-operator',
  profileVersion: 2,
  rightTypes: ['OPERATE', 'SELL'],
  scope: { territoryIds: ['north'] },
  exclusivityKey: 'north',
  effectiveFrom: '2026-08-25T09:00:00.000Z',
  effectiveUntil: '2027-08-25T09:00:00.000Z',
  sourceDecisionId: 'decision-1',
  grantedBySubjectId: 'subject-1',
  grantedAt: '2026-08-25T09:01:00.000Z',
  state: 'ACTIVE',
  evidenceRefs: ['decision:decision-1'],
};

const row = {
  grant_id: grant.grantId,
  tenant_id: grant.tenantId,
  instance_id: grant.instanceId,
  work_type_key: grant.workTypeKey,
  beneficiary_subject_id: null,
  beneficiary_organization_id: grant.beneficiaryOrganizationId,
  profile_key: grant.profileKey,
  profile_version: grant.profileVersion,
  right_types: grant.rightTypes,
  scope: grant.scope,
  exclusivity_key: grant.exclusivityKey,
  effective_from: grant.effectiveFrom,
  effective_until: grant.effectiveUntil,
  source_decision_id: grant.sourceDecisionId,
  source_agreement_id: null,
  execution_verification_id: null,
  granted_by_subject_id: grant.grantedBySubjectId,
  granted_at: grant.grantedAt,
  state: grant.state,
  evidence_refs: grant.evidenceRefs,
  revoked_at: null,
  revoked_by_subject_id: null,
  revocation_reason: null,
};

test('find resolves one tenant-scoped immutable grant', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowRightsGrantRepository(client).find({
    tenantId: grant.tenantId,
    grantId: grant.grantId,
  });

  assert.deepEqual(result, grant);
  assert.deepEqual(client.calls[0]?.values, [grant.tenantId, grant.grantId]);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[0]?.text ?? '', /grant_id = \$2::uuid/);
});

test('record returns COMMITTED for a newly inserted grant', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowRightsGrantRepository(client).record(grant);

  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(result.grant, grant);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT DO NOTHING/);
  assert.equal(client.calls[0]?.values[0], grant.grantId);
  assert.equal(client.calls[0]?.values[9], JSON.stringify(grant.scope));
});

test('record maps an exact immutable retry to ALREADY_RECORDED', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowRightsGrantRepository(client).record(grant);

  assert.equal(result.status, 'ALREADY_RECORDED');
  assert.deepEqual(result.grant, grant);
  assert.equal(client.calls.length, 2);
});

test('record returns CONFLICT when the immutable identity already has different content', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [{ ...row, right_types: ['OPERATE'] }], rowCount: 1 });

  const result = await new PostgresWorkflowRightsGrantRepository(client).record(grant);

  assert.equal(result.status, 'CONFLICT');
  assert.deepEqual(result.existing.rightTypes, ['OPERATE']);
});
