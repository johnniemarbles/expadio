import type {
  WorkflowRightsProfileDefinition,
  WorkflowRightsProfileProvider,
  WorkflowRightsScope,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface WorkflowRightsProfileRow {
  readonly tenant_id: string | null;
  readonly profile_key: string;
  readonly version: number;
  readonly label: string;
  readonly right_types: readonly string[];
  readonly maximum_scope: WorkflowRightsScope | null;
  readonly permits_exclusivity: boolean;
  readonly permits_delegation: boolean;
  readonly permits_sub_appointment: boolean;
  readonly default_duration: string | null;
  readonly renewal_model: string | null;
}

/**
 * Tenant-bound PostgreSQL adapter for exact rights-profile resolution.
 * Tenant versions override platform defaults with the same key/version.
 */
export class PostgresWorkflowRightsProfileProvider
  implements WorkflowRightsProfileProvider {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolve(input: {
    readonly tenantId: string;
    readonly profileKey: string;
    readonly version: number;
  }): Promise<WorkflowRightsProfileDefinition | null> {
    const result = await this.#client.query<WorkflowRightsProfileRow>(
      `SELECT tenant_id, profile_key, version, label, right_types,
              maximum_scope, permits_exclusivity, permits_delegation,
              permits_sub_appointment, default_duration, renewal_model
         FROM platform.workflow_rights_profiles
        WHERE $1::uuid = platform.current_tenant_id()
          AND profile_key = $2
          AND version = $3
          AND (tenant_id = $1::uuid OR tenant_id IS NULL)
        ORDER BY CASE WHEN tenant_id = $1::uuid THEN 0 ELSE 1 END
        LIMIT 1`,
      [input.tenantId, input.profileKey.trim(), input.version],
    );

    const row = result.rows[0];
    if (row === undefined) return null;

    return {
      profileKey: row.profile_key,
      version: row.version,
      label: row.label,
      rightTypes: [...row.right_types],
      ...(row.maximum_scope === null
        ? {}
        : { maximumScope: structuredClone(row.maximum_scope) }),
      permitsExclusivity: row.permits_exclusivity,
      permitsDelegation: row.permits_delegation,
      permitsSubAppointment: row.permits_sub_appointment,
      ...(row.default_duration === null ? {} : { defaultDuration: row.default_duration }),
      ...(row.renewal_model === null ? {} : { renewalModel: row.renewal_model }),
    };
  }
}
