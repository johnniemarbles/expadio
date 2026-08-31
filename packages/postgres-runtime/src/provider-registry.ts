import {
  credentialReference,
  type ConnectorDefinition,
  type ConnectorHealth,
  type ConnectorOwnership,
  type CredentialReference,
  type RoutingPolicy,
} from '@expadio/provider-registry';
import type {
  ConnectorCredentialRepository,
  ProviderRegistryRepository,
} from '@expadio/provider-registry/repository';
import type { PostgresClient } from './index.ts';

interface ConnectorRow {
  readonly connector_key: string;
  readonly provider_type: string;
  readonly provider_key: string;
  readonly ownership_scope: ConnectorOwnership;
  readonly tenant_id: string | null;
  readonly capability_keys: readonly string[];
  readonly region: string | null;
  readonly residency_tags: readonly string[];
  readonly compliance_tags: readonly string[];
  readonly health: ConnectorHealth;
  readonly priority: number;
  readonly enabled: boolean;
  readonly fallback_enabled: boolean;
}

interface RoutingPolicyRow {
  readonly tenant_id: string;
  readonly capability_key: string;
  readonly allowed_connector_keys: readonly string[] | null;
  readonly denied_connector_keys: readonly string[];
  readonly required_regions: readonly string[];
  readonly required_residency_tags: readonly string[];
  readonly required_compliance_tags: readonly string[];
  readonly prefer_tenant_owned: boolean;
}

interface CredentialRow {
  readonly credential_ref: string;
}

/** Tenant/request-role repository. It never selects connector credential rows. */
export class PostgresProviderRegistryRepository implements ProviderRegistryRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async listConnectors(
    tenantId: string,
    capabilityKey: string,
  ): Promise<readonly ConnectorDefinition[]> {
    const result = await this.#client.query<ConnectorRow>(
      `SELECT
         c.connector_key,
         c.provider_type,
         c.provider_key,
         c.ownership_scope,
         c.tenant_id,
         ARRAY_AGG(cap.capability_key ORDER BY cap.capability_key) AS capability_keys,
         c.region,
         c.residency_tags,
         c.compliance_tags,
         c.health,
         c.priority,
         c.enabled,
         c.fallback_enabled
       FROM platform.connectors c
       JOIN platform.connector_capabilities cc_all
         ON cc_all.connector_id = c.connector_id
       JOIN platform.capabilities cap
         ON cap.capability_id = cc_all.capability_id
       WHERE (c.tenant_id IS NULL OR c.tenant_id = $1::uuid)
         AND EXISTS (
           SELECT 1
             FROM platform.connector_capabilities cc_required
             JOIN platform.capabilities cap_required
               ON cap_required.capability_id = cc_required.capability_id
            WHERE cc_required.connector_id = c.connector_id
              AND cap_required.capability_key = $2
         )
       GROUP BY c.connector_id
       ORDER BY c.priority, c.connector_key`,
      [tenantId, capabilityKey],
    );

    return result.rows.map((row) => ({
      connectorKey: row.connector_key,
      providerType: row.provider_type,
      providerKey: row.provider_key,
      ownership: row.ownership_scope,
      ...(row.tenant_id !== null ? { tenantId: row.tenant_id } : {}),
      capabilityKeys: [...row.capability_keys],
      ...(row.region !== null ? { region: row.region } : {}),
      residencyTags: [...row.residency_tags],
      complianceTags: [...row.compliance_tags],
      health: row.health,
      priority: row.priority,
      enabled: row.enabled,
      fallbackEnabled: row.fallback_enabled,
    }));
  }

  async loadRoutingPolicy(tenantId: string, capabilityKey: string): Promise<RoutingPolicy | null> {
    const result = await this.#client.query<RoutingPolicyRow>(
      `SELECT
         rp.tenant_id,
         cap.capability_key,
         rp.allowed_connector_keys,
         rp.denied_connector_keys,
         rp.required_regions,
         rp.required_residency_tags,
         rp.required_compliance_tags,
         rp.prefer_tenant_owned
       FROM platform.connector_routing_policies rp
       JOIN platform.capabilities cap ON cap.capability_id = rp.capability_id
       WHERE rp.tenant_id = $1::uuid
         AND cap.capability_key = $2
         AND rp.enabled = true
         AND rp.effective_from <= now()
         AND (rp.effective_until IS NULL OR rp.effective_until > now())
       LIMIT 1`,
      [tenantId, capabilityKey],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      tenantId: row.tenant_id,
      capabilityKey: row.capability_key,
      ...(row.allowed_connector_keys !== null
        ? { allowedConnectorKeys: [...row.allowed_connector_keys] }
        : {}),
      deniedConnectorKeys: [...row.denied_connector_keys],
      requiredRegions: [...row.required_regions],
      requiredResidencyTags: [...row.required_residency_tags],
      requiredComplianceTags: [...row.required_compliance_tags],
      preferTenantOwned: row.prefer_tenant_owned,
    };
  }
}

/**
 * Infrastructure-role repository. The SQL keeps an explicit ownership check
 * even if the concrete infrastructure DB role can bypass tenant RLS.
 */
export class PostgresConnectorCredentialRepository implements ConnectorCredentialRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async loadCredentialReference(
    tenantId: string,
    connectorKey: string,
  ): Promise<CredentialReference | null> {
    const result = await this.#client.query<CredentialRow>(
      `SELECT cred.credential_ref
       FROM platform.connector_credentials cred
       JOIN platform.connectors c ON c.connector_id = cred.connector_id
       WHERE c.connector_key = $2
         AND c.enabled = true
         AND (
           c.ownership_scope = 'PLATFORM'
           OR (c.ownership_scope = 'TENANT' AND c.tenant_id = $1::uuid)
         )
       ORDER BY cred.rotated_at DESC NULLS LAST, cred.created_at DESC
       LIMIT 1`,
      [tenantId, connectorKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : credentialReference(row.credential_ref);
  }
}
