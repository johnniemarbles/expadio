import type { ClosureNode, ClosurePurpose, ClosureRepository, TerritorialNode } from '@expadio/entity';
import type { PostgresClient } from './index.ts';

interface ClosureNodeRow {
  readonly node_id: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly node_type: string;
  readonly display_name: string;
}

interface TerritorialNodeRow {
  readonly node_id: string;
  readonly node_type: string;
  readonly display_name: string;
  readonly effective_from: Date | string;
}

function mapClosureNode(row: ClosureNodeRow): ClosureNode {
  return {
    nodeId: row.node_id,
    depth: row.depth,
    path: row.path,
    nodeType: row.node_type,
    displayName: row.display_name,
  };
}

function mapTerritorialNode(row: TerritorialNodeRow): TerritorialNode {
  return {
    nodeId: row.node_id,
    nodeType: row.node_type,
    displayName: row.display_name,
    effectiveFrom: typeof row.effective_from === 'string' ? row.effective_from : row.effective_from.toISOString(),
  };
}

/**
 * Implements @expadio/entity's ClosureRepository against the SQL functions
 * shipped in migration 0131 (descending closures) and 0172 (ascending
 * governanceRoot/territorialAuthority). None of these SQL functions take a
 * tenant_id parameter -- they rely on the querying connection already being
 * scoped by RLS (see platform.current_tenant_id()), consistent with every
 * other RLS-scoped table in this codebase. The tenantId parameter on each
 * method here exists for interface conformance and is not passed to SQL.
 */
export class PostgresClosureRepository implements ClosureRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async governanceClosure(rootNodeId: string): Promise<readonly ClosureNode[]> {
    const result = await this.#client.query<ClosureNodeRow>(
      `SELECT node_id, depth, path, node_type, display_name FROM platform.governance_closure($1)`,
      [rootNodeId],
    );
    return result.rows.map(mapClosureNode);
  }

  async commercialClosure(rootNodeId: string): Promise<readonly ClosureNode[]> {
    const result = await this.#client.query<ClosureNodeRow>(
      `SELECT node_id, depth, path, node_type, display_name FROM platform.commercial_closure($1)`,
      [rootNodeId],
    );
    return result.rows.map(mapClosureNode);
  }

  async territorialClosure(authorityNodeId: string): Promise<readonly TerritorialNode[]> {
    const result = await this.#client.query<TerritorialNodeRow>(
      `SELECT node_id, node_type, display_name, effective_from FROM platform.territorial_closure($1)`,
      [authorityNodeId],
    );
    return result.rows.map(mapTerritorialNode);
  }

  async operationalClosure(rootNodeId: string): Promise<readonly ClosureNode[]> {
    const result = await this.#client.query<ClosureNodeRow>(
      `SELECT node_id, depth, path, node_type, display_name FROM platform.operational_closure($1)`,
      [rootNodeId],
    );
    return result.rows.map(mapClosureNode);
  }

  async isReachable(
    rootNodeId: string,
    candidateNodeId: string,
    purpose: ClosurePurpose,
  ): Promise<boolean> {
    const result = await this.#client.query<{ node_is_reachable: boolean }>(
      `SELECT platform.node_is_reachable($1, $2, $3) AS node_is_reachable`,
      [rootNodeId, candidateNodeId, purpose],
    );
    return result.rows[0]?.node_is_reachable ?? false;
  }

  async governanceRoot(nodeId: string): Promise<string> {
    const result = await this.#client.query<{ governance_root: string }>(
      `SELECT platform.governance_root($1) AS governance_root`,
      [nodeId],
    );
    const root = result.rows[0]?.governance_root;
    if (!root) {
      throw new Error(`GOVERNANCE_ROOT_UNRESOLVED: no node found for id "${nodeId}".`);
    }
    return root;
  }

  async territorialAuthority(nodeId: string): Promise<string | null> {
    const result = await this.#client.query<{ territorial_authority: string | null }>(
      `SELECT platform.territorial_authority($1) AS territorial_authority`,
      [nodeId],
    );
    return result.rows[0]?.territorial_authority ?? null;
  }
}
