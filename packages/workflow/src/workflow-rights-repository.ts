import type { WorkflowRightsGrant } from './workflow-rights.ts';

export type WorkflowRightsGrantCommitResult =
  | { readonly status: 'COMMITTED'; readonly grant: WorkflowRightsGrant }
  | { readonly status: 'ALREADY_RECORDED'; readonly grant: WorkflowRightsGrant }
  | { readonly status: 'CONFLICT'; readonly existing: WorkflowRightsGrant };

/**
 * Durable rights-grant persistence boundary.
 *
 * Exact retries are idempotent. A different immutable grant using the same
 * tenant/grant identity is a conflict and must never overwrite the original.
 */
export interface WorkflowRightsGrantRepository {
  find(input: {
    readonly tenantId: string;
    readonly grantId: string;
  }): Promise<WorkflowRightsGrant | null>;

  record(grant: WorkflowRightsGrant): Promise<WorkflowRightsGrantCommitResult>;
}
