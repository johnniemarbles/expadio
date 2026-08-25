import type {
  WorkflowActivationRightsAvailabilityDecision,
  WorkflowActivationRightsAvailabilityProvider,
  WorkflowActivationRightsAvailabilityRequest,
} from './workflow-activation-rights-availability.ts';
import type { WorkflowActivationRepository } from './workflow-activation-repository.ts';
import type { WorkflowActivationLifecycleRepository } from './workflow-activation-lifecycle-repository.ts';

/**
 * Derives rights availability from immutable activation provenance and lifecycle
 * history. It never mutates the original grant or completed workflow case.
 */
export class RepositoryWorkflowActivationRightsAvailabilityProvider
  implements WorkflowActivationRightsAvailabilityProvider {
  readonly #activations: WorkflowActivationRepository;
  readonly #lifecycle: WorkflowActivationLifecycleRepository;

  constructor(input: {
    readonly activations: WorkflowActivationRepository;
    readonly lifecycle: WorkflowActivationLifecycleRepository;
  }) {
    this.#activations = input.activations;
    this.#lifecycle = input.lifecycle;
  }

  async evaluate(
    request: WorkflowActivationRightsAvailabilityRequest,
  ): Promise<WorkflowActivationRightsAvailabilityDecision> {
    const evidenceRefs = [
      `activation:${request.activationId}`,
      `rights-grant:${request.rightsGrantId}`,
    ];

    const activation = await this.#activations.find({
      tenantId: request.tenantId,
      activationId: request.activationId,
    });
    if (activation === null) {
      return unavailable('ACTIVATION_NOT_FOUND', evidenceRefs);
    }
    if (activation.instanceId !== request.instanceId) {
      return unavailable('ACTIVATION_RIGHTS_INSTANCE_MISMATCH', evidenceRefs);
    }
    if (!activation.sourceRightsGrantIds.includes(request.rightsGrantId)) {
      return unavailable('ACTIVATION_RIGHTS_PROVENANCE_MISMATCH', evidenceRefs);
    }

    const state = await this.#lifecycle.currentState({
      tenantId: request.tenantId,
      activationId: request.activationId,
    });
    if (state === null) {
      return unavailable('ACTIVATION_RIGHTS_NOT_VERIFIED', evidenceRefs);
    }
    if (state === 'SUSPENDED') {
      return unavailable('ACTIVATION_RIGHTS_SUSPENDED', evidenceRefs, state);
    }
    if (state === 'REVOKED') {
      return unavailable('ACTIVATION_RIGHTS_REVOKED', evidenceRefs, state);
    }

    return {
      available: true,
      state: 'ACTIVE',
      code: 'ACTIVATION_RIGHTS_ACTIVE',
      evidenceRefs,
    };
  }
}

function unavailable(
  code: string,
  evidenceRefs: readonly string[],
  state?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
): WorkflowActivationRightsAvailabilityDecision {
  return {
    available: false,
    code,
    ...(state === undefined ? {} : { state }),
    evidenceRefs: [...evidenceRefs],
  };
}
