import type {
  WorkflowActivationRecord,
  WorkflowActivationRequest,
  WorkflowActivationResult,
  WorkflowActivationService,
} from './workflow-activation.ts';
import type { WorkflowActivationBlueprintProvider } from './workflow-activation-blueprint-provider.ts';
import type { WorkflowActivationRepository } from './workflow-activation-repository.ts';
import { validateWorkflowActivation } from './workflow-activation-validation.ts';

/** Validates and records activation intent; it performs no provisioning actions. */
export class RepositoryWorkflowActivationService
  implements WorkflowActivationService {
  readonly #blueprints: WorkflowActivationBlueprintProvider;
  readonly #repository: WorkflowActivationRepository;

  constructor(input: {
    readonly blueprints: WorkflowActivationBlueprintProvider;
    readonly repository: WorkflowActivationRepository;
  }) {
    this.#blueprints = input.blueprints;
    this.#repository = input.repository;
  }

  async activate(
    request: WorkflowActivationRequest,
  ): Promise<WorkflowActivationResult> {
    const blueprint = await this.#blueprints.resolve({
      tenantId: request.tenantId,
      blueprintKey: request.blueprint.blueprintKey,
      version: request.blueprint.version,
    });

    if (blueprint === null) {
      return denied(
        'ACTIVATION_BLUEPRINT_NOT_FOUND',
        `Activation blueprint ${request.blueprint.blueprintKey}@${request.blueprint.version} was not found.`,
        request.evidenceRefs,
      );
    }

    const validation = validateWorkflowActivation(blueprint, request);
    if (!validation.valid) {
      const first = validation.issues[0]!;
      return denied(first.code, first.message, request.evidenceRefs);
    }

    const activation: WorkflowActivationRecord = {
      tenantId: request.tenantId,
      instanceId: request.instanceId,
      workTypeKey: request.workTypeKey,
      activationId: request.activationId,
      blueprintKey: blueprint.blueprintKey,
      blueprintVersion: blueprint.version,
      provisioningModel: blueprint.provisioningModel,
      sourceRightsGrantIds: [...request.sourceRightsGrantIds],
      verificationState: 'NOT_VERIFIED',
      provisionedResourceRefs: [],
      startedAt: request.requestedAt,
      verificationEvidenceRefs: [...request.evidenceRefs],
    };

    const committed = await this.#repository.record(activation);
    switch (committed.status) {
      case 'COMMITTED':
        return { status: 'STARTED', activation: committed.activation };
      case 'ALREADY_RECORDED':
        return { status: 'ALREADY_STARTED', activation: committed.activation };
      case 'CONFLICT':
        return { status: 'CONFLICT', existing: committed.existing };
    }
  }
}

function denied(
  code: string,
  reason: string,
  evidenceRefs: readonly string[],
): WorkflowActivationResult {
  return { status: 'DENIED', code, reason, evidenceRefs: [...evidenceRefs] };
}
