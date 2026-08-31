import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import {
  createGovernedSupabaseArtifactStore,
} from '../lib/governed-artifact-storage.ts';

const source = readFileSync(
  new URL('../lib/governed-artifact-storage.ts', import.meta.url),
  'utf8',
);

test('governed artifact storage composes registry routing, credential leasing, and Supabase storage', () => {
  assert.match(source, /PostgresProviderRegistryRepository/);
  assert.match(source, /routeConnector/);
  assert.match(source, /createGovernedCredentialLeaseRuntime/);
  assert.match(source, /PostgresConnectorCredentialRepository/);
  assert.match(source, /governedSupabaseStorageAccessTokenProvider/);
  assert.match(source, /SupabaseDurableArtifactStore/);
  assert.match(source, /correlationId:\s*\(\) => correlationId/);
});

test('governed artifact storage fails closed when no compliant storage connector is available', async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text.includes('FROM platform.connectors')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM platform.connector_routing_policies')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error('unexpected SQL');
    },
  } as unknown as PoolClient;

  await assert.rejects(
    createGovernedSupabaseArtifactStore(client, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      serviceSubjectId: 'service-artifact-runtime',
      correlationId: 'corr-artifact-1',
      projectUrl: 'https://project.supabase.co',
      bucket: 'execution-artifacts',
      requiredResidencyTags: ['US'],
      requiredComplianceTags: ['SOC2'],
    }),
    /GOVERNED_ARTIFACT_STORAGE_CONNECTOR_UNAVAILABLE/,
  );

  assert.equal(queries.length, 4);
});


test('governed artifact storage refuses split storage routes', async () => {
  const row = (connectorKey: string) => ({
    connector_key: connectorKey,
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
  });

  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      if (text.includes('FROM platform.connectors')) {
        const capability = values[1];
        return {
          rows: [
            row(
              capability === 'storage.store'
                ? 'connector.storage.supabase.write'
                : 'connector.storage.supabase.read',
            ),
          ],
          rowCount: 1,
        };
      }
      if (text.includes('FROM platform.connector_routing_policies')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error('unexpected SQL');
    },
  } as unknown as PoolClient;

  await assert.rejects(
    createGovernedSupabaseArtifactStore(client, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      serviceSubjectId: 'service-artifact-runtime',
      correlationId: 'corr-artifact-split',
      projectUrl: 'https://project.supabase.co',
      bucket: 'execution-artifacts',
      requiredResidencyTags: ['US'],
      requiredComplianceTags: ['SOC2'],
    }),
    /GOVERNED_ARTIFACT_STORAGE_ROUTE_SPLIT_UNSUPPORTED/,
  );
});
