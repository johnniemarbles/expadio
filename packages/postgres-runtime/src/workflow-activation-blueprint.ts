import type {
  WorkflowActivationBlueprintDefinition,
  WorkflowActivationBlueprintProvider,
  WorkflowActivationStepDefinition,
  WorkflowProvisioningModel,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface WorkflowActivationBlueprintRow {
  readonly tenant_id: string | null;
  readonly blueprint_key: string;
  readonly version: number;
  readonly label: string;
  readonly work_type_key: string;
  readonly provisioning_model: WorkflowProvisioningModel;
  readonly steps: readonly WorkflowActivationStepDefinition[];
}

/**
 * Tenant-bound exact-version activation-blueprint resolution.
 * Tenant definitions override platform defaults with the same key/version.
 */
export class PostgresWorkflowActivationBlueprintProvider
  implements WorkflowActivationBlueprintProvider {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolve(input: {
    readonly tenantId: string;
    readonly blueprintKey: string;
    readonly version: number;
  }): Promise<WorkflowActivationBlueprintDefinition | null> {
    const result = await this.#client.query<WorkflowActivationBlueprintRow>(
      `SELECT tenant_id, blueprint_key, version, label, work_type_key,
              provisioning_model, steps
         FROM platform.workflow_activation_blueprints
        WHERE $1::uuid = platform.current_tenant_id()
          AND blueprint_key = $2
          AND version = $3
          AND (tenant_id = $1::uuid OR tenant_id IS NULL)
        ORDER BY CASE WHEN tenant_id = $1::uuid THEN 0 ELSE 1 END
        LIMIT 1`,
      [input.tenantId, input.blueprintKey.trim(), input.version],
    );

    const row = result.rows[0];
    if (row === undefined) return null;

    return {
      blueprintKey: row.blueprint_key,
      version: row.version,
      label: row.label,
      workTypeKey: row.work_type_key,
      provisioningModel: row.provisioning_model,
      steps: row.steps.map((step) => ({
        ...step,
        ...(step.parameters === undefined
          ? {}
          : { parameters: structuredClone(step.parameters) }),
      })),
    };
  }
}
