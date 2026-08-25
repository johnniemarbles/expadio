import type { WorkflowRightsProfileDefinition } from './workflow-rights.ts';

/**
 * Resolves the exact versioned rights profile referenced by a grant request.
 * Storage and inheritance remain outside the grant service.
 */
export interface WorkflowRightsProfileProvider {
  resolve(input: {
    readonly tenantId: string;
    readonly profileKey: string;
    readonly version: number;
  }): Promise<WorkflowRightsProfileDefinition | null>;
}
