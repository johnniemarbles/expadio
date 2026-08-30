import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConnectorDefinition } from '@expadio/provider-registry';
import { credentialReference } from '@expadio/provider-registry';
import type { EffectiveContext } from '@expadio/tenancy';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  createGovernedCredentialLeaseRuntime,
} from '../src/governed-credential-lease-runtime.ts';

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

const context: EffectiveContext = {
  subjectId: 'subject-1',
  actorKind: 'user',
  tenantId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
};

const connector: ConnectorDefinition = {
  connectorKey: 'resend-primary',
  providerType: 'email',
  providerKey: 'resend',
  ownership: 'TENANT',
  tenantId: context.tenantId,
  capabilityKeys: ['communication.email.send'],
  credentialRef: credentialReference(
    'vault://tenant/11111111-1111-1111-1111-111111111111/connector/resend-primary/v3',
  ),
  residencyTags: [],
  complianceTags: [],
  health: 'HEALTHY',
  priority: 1,
  enabled: true,
  fallbackEnabled: false,
};

test('composes persisted authorization with an audited 60-second credential lease', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      assignment_id: 'assignment-1',
      organization_id: context.organizationId,
      role_key: 'communications-operator',
      action_organization_ids: [context.organizationId],
      action_operating_unit_ids: null,
      action_resource_ids: null,
      visibility_organization_ids: null,
      visibility_operating_unit_ids: null,
      visibility_resource_ids: null,
      clearances: ['sensitive'],
      sensitive_compartments: ['provider-credentials'],
      action: 'credential.lease',
      resource_type: 'connector-credential',
      blocked_states: [],
    }],
    rowCount: 1,
  });
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [], rowCount: 1 });

  const runtime = createGovernedCredentialLeaseRuntime({
    client,
    contextProvider: {
      async resolve() {
        return context;
      },
    },
    now: () => '2026-08-30T05:10:00.000Z',
    decisionId: () => 'decision-1',
    leaseId: () => 'lease-1',
    issuerAuditId: () => 'issuer-audit-1',
    auditEventId: () => '33333333-3333-3333-3333-333333333333',
  });

  const lease = await runtime.issue({
    requestId: 'request-1',
    tenantId: context.tenantId,
    requestedBySubjectId: context.subjectId,
    connectorKey: connector.connectorKey,
    purpose: 'communication.email.send:system',
    requestedAt: '2026-08-30T05:09:59.000Z',
    correlationId: '44444444-4444-4444-4444-444444444444',
    evidenceRefs: ['communication://test-send/1'],
  }, connector);

  assert.equal(lease.authorizationDecisionId, 'decision-1');
  assert.equal(lease.issuedAt, '2026-08-30T05:10:00.000Z');
  assert.equal(lease.expiresAt, '2026-08-30T05:11:00.000Z');
  assert.equal(lease.credentialReference, connector.credentialRef);
  assert.equal(client.calls.length, 3);
  assert.match(client.calls[0]?.text ?? '', /authorization_assignments/);
  assert.match(client.calls[1]?.text ?? '', /authorization_restrictions/);
  assert.match(client.calls[2]?.text ?? '', /credential_lease_events/);
  assert.equal(client.calls[2]?.values.includes('secret-value'), false);
});
