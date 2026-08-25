import type {
  WorkflowActivationRecord,
  WorkflowActivationRequest,
  WorkflowActivationResult,
  WorkflowActivationService,
} from './workflow-activation.ts';
import type { WorkflowActivationBlueprintProvider } from './workflow-activation-blueprint-provider.ts';
import type { WorkflowActivationRepository } from './workflow-activation-repository.ts';
import { validateWorkflowActivation } from './workflow-activation-validation.ts';
import type { WorkflowRightsGrant } from './workflow-rights.ts';
import type { WorkflowRightsGrantRepository } from './workflow-rights-repository.ts';

/** Validates and records activation intent; it performs no provisioning actions. */
export class RepositoryWorkflowActivationService
  implements WorkflowActivationService {
  readonly #blueprints: WorkflowActivationBlueprintProvider;
  readonly #rights: WorkflowRightsGrantRepository;
  readonly #repository: WorkflowActivationRepository;

  constructor(input: {
    readonly blueprints: WorkflowActivationBlueprintProvider;
    readonly rights: WorkflowRightsGrantRepository;
    readonly repository: WorkflowActivationRepository;
  }) {
    this.#blueprints = input.blueprints;
    this.#rights = input.rights;
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

    if (new Set(request.sourceRightsGrantIds).size !== request.sourceRightsGrantIds.length) {
      return denied(
        'ACTIVATION_RIGHTS_GRANTS_DUPLICATE',
        'Activation source rights grant identities must be unique.',
        request.evidenceRefs,
      );
    }

    const grants = await Promise.all(request.sourceRightsGrantIds.map((grantId) =>
      this.#rights.find({ tenantId: request.tenantId, grantId })
    ));
    const rightsDenial = validateSourceRights(grants, request);
    if (rightsDenial !== null) {
      return denied(rightsDenial.code, rightsDenial.reason, request.evidenceRefs);
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

function validateSourceRights(
  grants: readonly (WorkflowRightsGrant | null)[],
  request: WorkflowActivationRequest,
): { readonly code: string; readonly reason: string } | null {
  const requestedAt = Date.parse(request.requestedAt);

  for (let index = 0; index < grants.length; index += 1) {
    const grantId = request.sourceRightsGrantIds[index]!;
    const grant = grants[index];

    if (grant === null || grant === undefined) {
      return {
        code: 'ACTIVATION_RIGHTS_GRANT_NOT_FOUND',
        reason: `Source rights grant ${grantId} was not found.`,
      };
    }

    if (
      grant.tenantId !== request.tenantId
      || grant.instanceId !== request.instanceId
      || grant.workTypeKey !== request.workTypeKey
    ) {
      return {
        code: 'ACTIVATION_RIGHTS_GRANT_MISMATCH',
        reason: `Source rights grant ${grantId} does not belong to this workflow activation.`,
      };
    }

    if (grant.state !== 'ACTIVE') {
      return {
        code: 'ACTIVATION_RIGHTS_GRANT_INACTIVE',
        reason: `Source rights grant ${grantId} is not active.`,
      };
    }

    if (
      Date.parse(grant.effectiveFrom) > requestedAt
      || (
        grant.effectiveUntil !== undefined
        && Date.parse(grant.effectiveUntil) <= requestedAt
      )
    ) {
      return {
        code: 'ACTIVATION_RIGHTS_GRANT_NOT_EFFECTIVE',
        reason: `Source rights grant ${grantId} is not effective at activation time.`,
      };
    }
  }

  return null;
}

function denied(
  code: string,
  reason: string,
  evidenceRefs: readonly string[],
): WorkflowActivationResult {
  return { status: 'DENIED', code, reason, evidenceRefs: [...evidenceRefs] };
}
