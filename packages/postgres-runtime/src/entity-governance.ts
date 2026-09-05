import type { ContentPublishingPolicy, GovernancePolicyRepository } from '@expadio/entity';
import type { PostgresClient } from './index.ts';

interface ResolvedPolicyRow {
  readonly resolve_publishing_policy: ContentPublishingPolicy | null;
}

export class PostgresGovernancePolicyRepository implements GovernancePolicyRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveConfiguredPolicy(
    nodeId: string,
    tenantId: string,
  ): Promise<ContentPublishingPolicy | null> {
    const result = await this.#client.query<ResolvedPolicyRow>(
      `SELECT platform.resolve_publishing_policy($1, $2) AS resolve_publishing_policy`,
      [tenantId, nodeId],
    );
    return result.rows[0]?.resolve_publishing_policy ?? null;
  }
}

export async function upsertEntityGovernanceConfig(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly nodeId: string;
    readonly publishingPolicy: ContentPublishingPolicy;
    readonly updatedBy: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.entity_governance_config (
       tenant_id, node_id, publishing_policy, updated_by, updated_at
     ) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id, node_id)
     DO UPDATE SET
       publishing_policy = EXCLUDED.publishing_policy,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.tenantId, input.nodeId, input.publishingPolicy, input.updatedBy],
  );
}
