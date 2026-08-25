import type { WorkflowActivationRecord } from './workflow-activation.ts';

export type WorkflowActivationCommitResult =
  | { readonly status: 'COMMITTED'; readonly activation: WorkflowActivationRecord }
  | { readonly status: 'ALREADY_RECORDED'; readonly activation: WorkflowActivationRecord }
  | { readonly status: 'CONFLICT'; readonly existing: WorkflowActivationRecord };

/**
 * Durable activation-start boundary. Exact retries are idempotent; a different
 * record using the same tenant/activation identity must never overwrite the first.
 */
export interface WorkflowActivationRepository {
  find(input: {
    readonly tenantId: string;
    readonly activationId: string;
  }): Promise<WorkflowActivationRecord | null>;

  record(activation: WorkflowActivationRecord): Promise<WorkflowActivationCommitResult>;
}
