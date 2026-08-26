import {
  validateAgentCapabilityManifest,
  type AgentCapabilityManifest,
  type AgentCapabilityManifestRepository,
  type AgentCapabilityManifestScope,
} from '@expadio/capabilities';
import type { PostgresClient } from './index.ts';

interface AgentCapabilityManifestRow {
  readonly kind: AgentCapabilityManifest['kind'];
  readonly capability_key: string;
  readonly version: number;
  readonly state: AgentCapabilityManifest['state'];
  readonly scope_kind: AgentCapabilityManifestScope['kind'];
  readonly scope_key: string | null;
  readonly tenant_id: string | null;
  readonly owner_subject_id: string;
  readonly instruction_reference: string;
  readonly instruction_digest: string;
  readonly input_schema: AgentCapabilityManifest['inputSchema'];
  readonly output_schema: AgentCapabilityManifest['outputSchema'];
  readonly required_permission_keys: readonly string[];
  readonly allowed_tool_keys: readonly string[];
  readonly negative_constraint_keys: readonly string[];
  readonly budget_policy_reference: string;
  readonly max_steps: number;
  readonly max_cost_minor_units: number;
  readonly timeout_seconds: number;
  readonly stop_condition_keys: readonly string[];
  readonly escalation_policy_reference: string;
  readonly skill_references: AgentCapabilityManifest['skillReferences'];
  readonly verified_at: Date | string | null;
  readonly effective_from: Date | string;
  readonly evidence_refs: readonly string[];
}

/**
 * Read adapter for published agent capability resolution.
 *
 * The supplied client must already have transaction-local tenant context bound.
 * Forced table RLS exposes platform/vertical rows and only the current tenant's
 * tenant-scoped rows; the domain resolver applies requested vertical precedence.
 */
export class PostgresAgentCapabilityManifestRepository
implements AgentCapabilityManifestRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async findByKindAndKey(
    kind: AgentCapabilityManifest['kind'],
    key: string,
  ): Promise<readonly AgentCapabilityManifest[]> {
    const result = await this.#client.query<AgentCapabilityManifestRow>(
      `SELECT kind, capability_key, version, state, scope_kind, scope_key,
              tenant_id, owner_subject_id, instruction_reference,
              instruction_digest, input_schema, output_schema,
              required_permission_keys, allowed_tool_keys,
              negative_constraint_keys, budget_policy_reference, max_steps,
              max_cost_minor_units, timeout_seconds, stop_condition_keys,
              escalation_policy_reference, skill_references, verified_at,
              effective_from, evidence_refs
         FROM platform.agent_capability_manifests
        WHERE kind = $1
          AND capability_key = $2
        ORDER BY
          CASE scope_kind
            WHEN 'TENANT' THEN 1
            WHEN 'VERTICAL' THEN 2
            ELSE 3
          END,
          scope_key NULLS LAST,
          version DESC`,
      [kind, key],
    );

    return result.rows.map(mapRow);
  }
}

function mapRow(row: AgentCapabilityManifestRow): AgentCapabilityManifest {
  const manifest: AgentCapabilityManifest = {
    kind: row.kind,
    key: row.capability_key,
    version: row.version,
    state: row.state,
    scope: mapScope(row),
    ownerSubjectId: row.owner_subject_id,
    instructionReference: row.instruction_reference,
    instructionDigest: row.instruction_digest,
    inputSchema: { ...row.input_schema },
    outputSchema: { ...row.output_schema },
    requiredPermissionKeys: [...row.required_permission_keys],
    allowedToolKeys: [...row.allowed_tool_keys],
    negativeConstraintKeys: [...row.negative_constraint_keys],
    budgetPolicyReference: row.budget_policy_reference,
    maxSteps: row.max_steps,
    maxCostMinorUnits: row.max_cost_minor_units,
    timeoutSeconds: row.timeout_seconds,
    stopConditionKeys: [...row.stop_condition_keys],
    escalationPolicyReference: row.escalation_policy_reference,
    skillReferences: row.skill_references.map((reference) => ({ ...reference })),
    verifiedAt: row.verified_at === null ? null : iso(row.verified_at),
    effectiveFrom: iso(row.effective_from),
    evidenceRefs: [...row.evidence_refs],
  };
  validateAgentCapabilityManifest(manifest);
  return manifest;
}

function mapScope(row: AgentCapabilityManifestRow): AgentCapabilityManifestScope {
  if (row.scope_kind === 'PLATFORM') {
    if (row.scope_key !== null || row.tenant_id !== null) {
      throw new Error('AGENT_CAPABILITY_PLATFORM_SCOPE_INVALID');
    }
    return { kind: 'PLATFORM' };
  }
  if (row.scope_kind === 'VERTICAL') {
    if (row.scope_key === null || row.tenant_id !== null) {
      throw new Error('AGENT_CAPABILITY_VERTICAL_SCOPE_INVALID');
    }
    return { kind: 'VERTICAL', verticalKey: row.scope_key };
  }
  if (
    row.tenant_id === null
    || row.scope_key === null
    || row.scope_key !== row.tenant_id
  ) {
    throw new Error('AGENT_CAPABILITY_TENANT_SCOPE_INVALID');
  }
  return { kind: 'TENANT', tenantId: row.tenant_id };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
