import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConnectorFromRegistry } from '@expadio/provider-registry/repository';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '../src/provider-registry.ts';
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

test('tenant registry lookup maps connector metadata without querying credentials', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      connector_key: 'tenant-email',
      provider_type: 'email',
      provider_key: 'provider-a',
      ownership_scope: 'TENANT',
      tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      capability_keys: ['email.delivery'],
      region: 'ca-central',
      residency_tags: ['CA'],
      compliance_tags: ['PIPEDA'],
      health: 'HEALTHY',
      priority: 10,
      enabled: true,
      fallback_enabled: true,
    }],
  });

  const repository = new PostgresProviderRegistryRepository(client);
  const connectors = await repository.listConnectors(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'email.delivery',
  );

  assert.equal(connectors[0]?.connectorKey, 'tenant-email');
  assert.equal(connectors[0]?.credentialRef, undefined);
  assert.doesNotMatch(client.calls[0]?.text ?? '', /connector_credentials/);
  assert.deepEqual(client.calls[0]?.values, [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'email.delivery',
  ]);
});

test('routing policy maps nullable allow-list separately from required constraints', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      capability_key: 'email.delivery',
      allowed_connector_keys: null,
      denied_connector_keys: ['blocked'],
      required_regions: ['ca-central'],
      required_residency_tags: ['CA'],
      required_compliance_tags: ['PIPEDA'],
      prefer_tenant_owned: true,
    }],
  });

  const repository = new PostgresProviderRegistryRepository(client);
  const policy = await repository.loadRoutingPolicy(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'email.delivery',
  );

  assert.deepEqual(policy, {
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    capabilityKey: 'email.delivery',
    deniedConnectorKeys: ['blocked'],
    requiredRegions: ['ca-central'],
    requiredResidencyTags: ['CA'],
    requiredComplianceTags: ['PIPEDA'],
    preferTenantOwned: true,
  });
});

test('credential repository uses explicit tenant/platform ownership predicate', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{ credential_ref: 'vault://tenant-a/email' }],
  });

  const repository = new PostgresConnectorCredentialRepository(client);
  const reference = await repository.loadCredentialReference(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'tenant-email',
  );

  assert.equal(reference, 'vault://tenant-a/email');
  assert.match(client.calls[0]?.text ?? '', /ownership_scope = 'PLATFORM'/);
  assert.match(client.calls[0]?.text ?? '', /c\.tenant_id = \$1::uuid/);
  assert.deepEqual(client.calls[0]?.values, [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'tenant-email',
  ]);
});

test('registry-driven routing loads connectors and policy then applies pure routing rules', async () => {
  const calls: string[] = [];
  const result = await routeConnectorFromRegistry(
    {
      async listConnectors() {
        calls.push('connectors');
        return [{
          connectorKey: 'platform-email',
          providerType: 'email',
          providerKey: 'provider-a',
          ownership: 'PLATFORM',
          capabilityKeys: ['email.delivery'],
          region: 'ca-central',
          residencyTags: ['CA'],
          complianceTags: ['PIPEDA'],
          health: 'HEALTHY',
          priority: 10,
          enabled: true,
          fallbackEnabled: true,
        }];
      },
      async loadRoutingPolicy() {
        calls.push('policy');
        return {
          tenantId: 'tenant-a',
          capabilityKey: 'email.delivery',
          requiredResidencyTags: ['CA'],
        };
      },
    },
    { tenantId: 'tenant-a', capabilityKey: 'email.delivery' },
  );

  assert.equal(result.reason, 'ROUTED');
  assert.equal(result.connector?.connectorKey, 'platform-email');
  assert.deepEqual(new Set(calls), new Set(['connectors', 'policy']));
});


test('tenant registry lookup preserves all connector capabilities while filtering by one required capability', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      connector_key: 'platform-storage',
      provider_type: 'supabase-storage',
      provider_key: 'supabase',
      ownership_scope: 'PLATFORM',
      tenant_id: null,
      capability_keys: ['storage.read', 'storage.store'],
      region: 'us-east',
      residency_tags: ['US'],
      compliance_tags: ['SOC2'],
      health: 'HEALTHY',
      priority: 1,
      enabled: true,
      fallback_enabled: false,
    }],
  });

  const repository = new PostgresProviderRegistryRepository(client);
  const connectors = await repository.listConnectors(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'storage.store',
  );

  assert.deepEqual(connectors[0]?.capabilityKeys, ['storage.read', 'storage.store']);
  assert.match(client.calls[0]?.text ?? '', /EXISTS\s*\(/);
  assert.match(client.calls[0]?.text ?? '', /cc_all/);
  assert.match(client.calls[0]?.text ?? '', /cap_required\.capability_key = \$2/);
});
