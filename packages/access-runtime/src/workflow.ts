import type { EffectiveContext } from '@expadio/tenancy';
import type { WorkflowTransitionAuthorizationProvider } from '@expadio/workflow';
import {
  authorizePersistedAccess,
  type AccessRuntimeDependencies,
} from './index.ts';

export class PersistedWorkflowAuthorizationProvider
  implements WorkflowTransitionAuthorizationProvider {
  readonly #dependencies: AccessRuntimeDependencies;
  readonly #effectiveContext: EffectiveContext;
  readonly #entitlements?: ReadonlySet<string>;
  readonly #requiredCapabilityKey?: string;

  constructor(input: {
    readonly dependencies: AccessRuntimeDependencies;
    readonly effectiveContext: EffectiveContext;
    readonly entitlements?: ReadonlySet<string>;
    readonly requiredCapabilityKey?: string;
  }) {
    this.#dependencies = input.dependencies;
    this.#effectiveContext = input.effectiveContext;
    this.#entitlements = input.entitlements;
    this.#requiredCapabilityKey = input.requiredCapabilityKey;
  }

  async authorize(input: Parameters<WorkflowTransitionAuthorizationProvider['authorize']>[0]) {
    if (input.tenantId !== this.#effectiveContext.tenantId) {
      return {
        allowed: false,
        code: 'TENANT_MISMATCH',
        evidenceRefs: [] as readonly string[],
      };
    }
    if (input.actorSubjectId !== this.#effectiveContext.subjectId) {
      return {
        allowed: false,
        code: 'ACTOR_SUBJECT_MISMATCH',
        evidenceRefs: [] as readonly string[],
      };
    }

    const decision = await authorizePersistedAccess(this.#dependencies, {
      context: this.#effectiveContext,
      query: {
        action: input.action,
        intent: 'act',
        resource: {
          type: 'WORKFLOW_INSTANCE',
          id: input.instanceId,
          tenantId: input.tenantId,
          organizationId: this.#effectiveContext.organizationId,
        },
      },
      ...(this.#entitlements === undefined ? {} : { entitlements: this.#entitlements }),
      ...(this.#requiredCapabilityKey === undefined
        ? {}
        : { requiredCapabilityKey: this.#requiredCapabilityKey }),
    });

    return {
      allowed: decision.allowed,
      code: decision.reasonKey,
      evidenceRefs: [
        ...(decision.viaRole === undefined ? [] : [`role:${decision.viaRole}`]),
        ...(decision.vetoedBy === undefined ? [] : [`sod:${decision.vetoedBy}`]),
        ...(decision.capabilityKey === undefined
          ? []
          : [`capability:${decision.capabilityKey}:${decision.capabilityState ?? 'UNKNOWN'}`]),
      ],
    };
  }
}
