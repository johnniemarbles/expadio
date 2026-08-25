import type { WorkflowActivationRepository } from './workflow-activation-repository.ts';
import type {
  WorkflowActivationLifecycleEvent,
  WorkflowActivationLifecycleRequest,
  WorkflowActivationLifecycleResult,
  WorkflowActivationLifecycleService,
} from './workflow-activation-lifecycle.ts';
import type { WorkflowActivationLifecycleRepository } from './workflow-activation-lifecycle-repository.ts';
import { validateWorkflowActivationLifecycle } from './workflow-activation-lifecycle-validation.ts';
import type { WorkflowActivationVerificationRepository } from './workflow-activation-verification-repository.ts';

/**
 * Applies standing-control decisions to immutable activation lifecycle history.
 * Completed workflow cases and original rights grants are never rewritten.
 */
export class RepositoryWorkflowActivationLifecycleService
  implements WorkflowActivationLifecycleService {
  readonly #activations: WorkflowActivationRepository;
  readonly #verifications: WorkflowActivationVerificationRepository;
  readonly #lifecycle: WorkflowActivationLifecycleRepository;

  constructor(input: {
    readonly activations: WorkflowActivationRepository;
    readonly verifications: WorkflowActivationVerificationRepository;
    readonly lifecycle: WorkflowActivationLifecycleRepository;
  }) {
    this.#activations = input.activations;
    this.#verifications = input.verifications;
    this.#lifecycle = input.lifecycle;
  }

  async apply(
    request: WorkflowActivationLifecycleRequest,
  ): Promise<WorkflowActivationLifecycleResult> {
    const validation = validateWorkflowActivationLifecycle(request);
    if (!validation.valid) {
      const first = validation.issues[0]!;
      return denied(first.code, first.message, request.evidenceRefs);
    }

    const event = lifecycleEvent(request, validation.toState);
    const existingEvent = await this.#lifecycle.findEvent({
      tenantId: request.tenantId,
      eventId: request.eventId,
    });
    if (existingEvent !== null) {
      return sameEvent(existingEvent, event)
        ? { status: 'ALREADY_APPLIED', event: existingEvent }
        : denied(
            'ACTIVATION_LIFECYCLE_EVENT_CONFLICT',
            `Lifecycle event ${request.eventId} already has different immutable content.`,
            request.evidenceRefs,
          );
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
        'ACTIVATION_LIFECYCLE_INSTANCE_MISMATCH',
        'Lifecycle event does not belong to the activation workflow instance.',
        request.evidenceRefs,
      );
    }

    if (
      activation.startedAt !== undefined
      && Date.parse(request.performedAt) < Date.parse(activation.startedAt)
    ) {
      return denied(
        'ACTIVATION_LIFECYCLE_BEFORE_START',
        'Lifecycle event cannot predate activation start.',
        request.evidenceRefs,
      );
    }

    const sourceRights = new Set(activation.sourceRightsGrantIds);
    if (!request.affectedRightsGrantIds.every((grantId) => sourceRights.has(grantId))) {
      return denied(
        'ACTIVATION_LIFECYCLE_RIGHTS_MISMATCH',
        'Affected rights must belong to the activation source rights.',
        request.evidenceRefs,
      );
    }

    if (request.sourceVerificationId !== undefined) {
      const verification = await this.#verifications.find({
        tenantId: request.tenantId,
        verificationId: request.sourceVerificationId,
      });
      if (verification === null) {
        return denied(
          'ACTIVATION_LIFECYCLE_VERIFICATION_NOT_FOUND',
          `Source verification ${request.sourceVerificationId} was not found.`,
          request.evidenceRefs,
        );
      }
      if (
        verification.activationId !== request.activationId
        || verification.instanceId !== request.instanceId
      ) {
        return denied(
          'ACTIVATION_LIFECYCLE_VERIFICATION_MISMATCH',
          'Source verification does not belong to this activation.',
          request.evidenceRefs,
        );
      }
      if (Date.parse(verification.verifiedAt) > Date.parse(request.performedAt)) {
        return denied(
          'ACTIVATION_LIFECYCLE_VERIFICATION_AFTER_EVENT',
          'Source verification cannot postdate the lifecycle event.',
          request.evidenceRefs,
        );
      }
    }

    const currentState = await this.#lifecycle.currentState({
      tenantId: request.tenantId,
      activationId: request.activationId,
    });
    if (currentState === null) {
      return denied(
        'ACTIVATION_LIFECYCLE_NOT_VERIFIED',
        'Lifecycle actions require a verified activation.',
        request.evidenceRefs,
      );
    }
    if (currentState !== request.expectedFromState) {
      return { status: 'CONFLICT', currentState };
    }

    const committed = await this.#lifecycle.append(event);
    switch (committed.status) {
      case 'COMMITTED':
        return { status: 'APPLIED', event: committed.event };
      case 'ALREADY_RECORDED':
        return { status: 'ALREADY_APPLIED', event: committed.event };
      case 'EVENT_CONFLICT':
        return denied(
          'ACTIVATION_LIFECYCLE_EVENT_CONFLICT',
          `Lifecycle event ${request.eventId} already has different immutable content.`,
          request.evidenceRefs,
        );
      case 'STATE_CONFLICT':
        return { status: 'CONFLICT', currentState: committed.currentState };
    }
  }
}

function lifecycleEvent(
  request: WorkflowActivationLifecycleRequest,
  toState: WorkflowActivationLifecycleEvent['toState'],
): WorkflowActivationLifecycleEvent {
  return {
    eventId: request.eventId,
    tenantId: request.tenantId,
    instanceId: request.instanceId,
    activationId: request.activationId,
    fromState: request.expectedFromState,
    toState,
    action: request.action,
    affectedRightsGrantIds: [...request.affectedRightsGrantIds],
    monitoringTriggerKey: request.monitoringTriggerKey,
    ...(request.sourceVerificationId === undefined
      ? {}
      : { sourceVerificationId: request.sourceVerificationId }),
    performedBySubjectId: request.performedBySubjectId,
    performedAt: request.performedAt,
    reason: request.reason,
    evidenceRefs: [...request.evidenceRefs],
  };
}

function sameEvent(
  left: WorkflowActivationLifecycleEvent,
  right: WorkflowActivationLifecycleEvent,
): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(event: WorkflowActivationLifecycleEvent): Record<string, unknown> {
  return {
    ...event,
    affectedRightsGrantIds: [...event.affectedRightsGrantIds],
    performedAt: new Date(event.performedAt).toISOString(),
    evidenceRefs: [...event.evidenceRefs],
  };
}

function denied(
  code: string,
  reason: string,
  evidenceRefs: readonly string[],
): WorkflowActivationLifecycleResult {
  return { status: 'DENIED', code, reason, evidenceRefs: [...evidenceRefs] };
}
