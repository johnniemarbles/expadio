import type { WorkflowActivationRepository } from './workflow-activation-repository.ts';
import type {
  WorkflowActivationVerificationRecord,
  WorkflowActivationVerificationRequest,
  WorkflowActivationVerificationResult,
  WorkflowActivationVerificationService,
} from './workflow-activation-verification.ts';
import type { WorkflowActivationVerificationRepository } from './workflow-activation-verification-repository.ts';
import { validateWorkflowActivationVerification } from './workflow-activation-verification-validation.ts';

/** Validates and records verification facts; it does not mutate activation history. */
export class RepositoryWorkflowActivationVerificationService
  implements WorkflowActivationVerificationService {
  readonly #activations: WorkflowActivationRepository;
  readonly #verifications: WorkflowActivationVerificationRepository;

  constructor(input: {
    readonly activations: WorkflowActivationRepository;
    readonly verifications: WorkflowActivationVerificationRepository;
  }) {
    this.#activations = input.activations;
    this.#verifications = input.verifications;
  }

  async verify(
    request: WorkflowActivationVerificationRequest,
  ): Promise<WorkflowActivationVerificationResult> {
    const validation = validateWorkflowActivationVerification(request);
    if (!validation.valid) {
      const first = validation.issues[0]!;
      return denied(first.code, first.message, request.evidenceRefs);
    }

    const activation = await this.#activations.find({
      tenantId: request.tenantId,
      activationId: request.activationId,
    });
    if (activation === null) {
      return denied(
        'ACTIVATION_NOT_FOUND',
        `Activation ${request.activationId} was not found.`,
        request.evidenceRefs,
      );
    }

    if (activation.instanceId !== request.instanceId) {
      return denied(
        'ACTIVATION_VERIFICATION_INSTANCE_MISMATCH',
        'Verification does not belong to the activation workflow instance.',
        request.evidenceRefs,
      );
    }

    if (
      activation.startedAt !== undefined
      && Date.parse(request.verifiedAt) < Date.parse(activation.startedAt)
    ) {
      return denied(
        'ACTIVATION_VERIFICATION_BEFORE_START',
        'Verification cannot predate activation start.',
        request.evidenceRefs,
      );
    }

    const verification: WorkflowActivationVerificationRecord = {
      verificationId: request.verificationId,
      tenantId: request.tenantId,
      instanceId: request.instanceId,
      activationId: request.activationId,
      state: request.assessments.some(
        (assessment) => assessment.outcome === 'NOT_SATISFIED',
      )
        ? 'FAILED'
        : 'VERIFIED',
      assessments: request.assessments.map((assessment) => ({
        ...assessment,
        evidenceRefs: [...assessment.evidenceRefs],
      })),
      verifiedBySubjectId: request.verifiedBySubjectId,
      verifiedAt: request.verifiedAt,
      reason: request.reason,
      evidenceRefs: [...request.evidenceRefs],
    };

    const committed = await this.#verifications.record(verification);
    switch (committed.status) {
      case 'COMMITTED':
        return { status: 'RECORDED', verification: committed.verification };
      case 'ALREADY_RECORDED':
        return {
          status: 'ALREADY_RECORDED',
          verification: committed.verification,
        };
      case 'CONFLICT':
        return { status: 'CONFLICT', existing: committed.existing };
    }
  }
}

function denied(
  code: string,
  reason: string,
  evidenceRefs: readonly string[],
): WorkflowActivationVerificationResult {
  return { status: 'DENIED', code, reason, evidenceRefs: [...evidenceRefs] };
}
