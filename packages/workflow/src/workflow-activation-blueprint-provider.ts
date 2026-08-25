import type { WorkflowActivationBlueprintDefinition } from './workflow-activation.ts';

export interface WorkflowActivationBlueprintProvider {
  resolve(input: {
    readonly tenantId: string;
    readonly blueprintKey: string;
    readonly version: number;
  }): Promise<WorkflowActivationBlueprintDefinition | null>;
}
