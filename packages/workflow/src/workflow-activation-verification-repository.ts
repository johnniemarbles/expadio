import type { WorkflowActivationVerificationRecord } from './workflow-activation-verification.ts';

export type WorkflowActivationVerificationCommitResult =
  | {
      readonly status: 'COMMITTED';
      readonly verification: WorkflowActivationVerificationRecord;
    }
  | {
      readonly status: 'ALREADY_RECORDED';
      readonly verification: WorkflowActivationVerificationRecord;
    }
  | {
      readonly status: 'CONFLICT';
      readonly existing: WorkflowActivationVerificationRecord;
    };

/**
 * Append-only activation-verification boundary. Exact retries are idempotent;
 * a different fact using the same tenant/verification identity is a conflict.
 */
export interface WorkflowActivationVerificationRepository {
  find(input: {
    readonly tenantId: string;
    readonly verificationId: string;
  }): Promise<WorkflowActivationVerificationRecord | null>;

  record(
    verification: WorkflowActivationVerificationRecord,
  ): Promise<WorkflowActivationVerificationCommitResult>;
}
