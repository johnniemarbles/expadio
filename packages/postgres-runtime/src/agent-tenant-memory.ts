import type { PostgresClient } from './index.ts';

export interface AgentTenantMemoryRecord {
  readonly tenantId: string;
  readonly memoryKey: string;
  readonly memoryValue: unknown;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

interface RawMemoryRow {
  readonly tenant_id: string;
  readonly memory_key: string;
  readonly memory_value: unknown;
  readonly metadata: Record<string, unknown> | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export async function upsertAgentTenantMemory(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly memoryKey: string;
    readonly memoryValue: unknown;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.agent_tenant_memory (
       tenant_id, memory_key, memory_value, metadata, updated_at
     ) VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (tenant_id, memory_key)
     DO UPDATE SET
       memory_value = EXCLUDED.memory_value,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      input.tenantId,
      input.memoryKey,
      JSON.stringify(input.memoryValue),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function getAgentTenantMemory(
  client: PostgresClient,
  tenantId: string,
  memoryKey: string,
): Promise<AgentTenantMemoryRecord | null> {
  const result = await client.query<RawMemoryRow>(
    `SELECT tenant_id, memory_key, memory_value, metadata, created_at, updated_at
       FROM platform.agent_tenant_memory
      WHERE tenant_id = $1 AND memory_key = $2`,
    [tenantId, memoryKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    memoryKey: row.memory_key,
    memoryValue: row.memory_value,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generic tenant-scoped artifact store backed by platform.agent_tenant_memory,
 * for governed tool outputs that need to be read back by a later step (e.g.
 * the Decision Fabric approval deck rendering a staged draft) but are too
 * large or structured to embed directly in an AgentToolObservation, which
 * only ever carries a reference. See @expadio/agent-runtime's
 * EditorialArtifactStore for the consumer-side port this satisfies.
 */
export class PostgresAgentArtifactStore {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async save(input: { readonly tenantId: string; readonly key: string; readonly value: unknown }): Promise<void> {
    await upsertAgentTenantMemory(this.#client, {
      tenantId: input.tenantId,
      memoryKey: input.key,
      memoryValue: input.value,
    });
  }
}
