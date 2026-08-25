import type {
  PinnedWorkflowBlueprint,
  WorkflowBlueprintDefinition,
} from './index.ts';
import type { WorkflowBlueprintRepository, WorkflowBlueprintScope } from './blueprint-repository.ts';

export type WorkflowBlueprintResolutionReason =
  | 'TENANT_ACTIVE_OVERRIDE'
  | 'PLATFORM_ACTIVE_DEFAULT'
  | 'EXPLICIT_PIN';

export interface WorkflowBlueprintResolutionContext {
  readonly tenantId: string;
  readonly workTypeKey: string;
  /**
   * When present, the resolver must return this exact blueprint identity from
   * the pinned scope or fail. Frozen pins may resolve SUPERSEDED versions.
   */
  readonly pinned?: PinnedWorkflowBlueprint;
}

export interface WorkflowBlueprintResolutionResult {
  readonly blueprint: WorkflowBlueprintDefinition;
  readonly reason: WorkflowBlueprintResolutionReason;
  readonly precedenceTrace: readonly string[];
}

/**
 * Resolves an executable workflow blueprint for a tenant/work type.
 *
 * Precedence contract:
 * 1. an explicit pin wins and must resolve exactly from its pinned scope;
 * 2. otherwise the tenant ACTIVE customization wins;
 * 3. otherwise the platform ACTIVE default is used;
 * 4. absence is an explicit resolution failure, never an implicit draft pick.
 *
 * The resolver never mutates or publishes blueprints. Lifecycle-specific
 * decisions about when to pin or re-resolve belong to the consuming case or
 * journey runtime.
 */
export interface WorkflowBlueprintResolver {
  resolve(
    context: WorkflowBlueprintResolutionContext,
  ): Promise<WorkflowBlueprintResolutionResult>;
}

export class WorkflowBlueprintResolutionError extends Error {
  readonly code:
    | 'WORKFLOW_BLUEPRINT_PIN_NOT_FOUND'
    | 'WORKFLOW_BLUEPRINT_PIN_WORK_TYPE_MISMATCH'
    | 'WORKFLOW_BLUEPRINT_ACTIVE_AMBIGUOUS'
    | 'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND';

  constructor(
    code:
      | 'WORKFLOW_BLUEPRINT_PIN_NOT_FOUND'
      | 'WORKFLOW_BLUEPRINT_PIN_WORK_TYPE_MISMATCH'
      | 'WORKFLOW_BLUEPRINT_ACTIVE_AMBIGUOUS'
      | 'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowBlueprintResolutionError';
    this.code = code;
  }
}

/** Framework-free resolver over the repository port. */
export class RepositoryWorkflowBlueprintResolver implements WorkflowBlueprintResolver {
  readonly #repository: WorkflowBlueprintRepository;

  constructor(repository: WorkflowBlueprintRepository) {
    this.#repository = repository;
  }

  async resolve(
    context: WorkflowBlueprintResolutionContext,
  ): Promise<WorkflowBlueprintResolutionResult> {
    if (context.pinned !== undefined) {
      return this.#resolvePinned(context);
    }

    const tenantCandidates = await this.#repository.listActiveForWorkType({
      scope: { type: 'TENANT', tenantId: context.tenantId },
      workTypeKey: context.workTypeKey,
    });
    const tenant = exactlyOneOrNone(
      tenantCandidates,
      'tenant',
      context.workTypeKey,
    );
    if (tenant !== null) {
      return {
        blueprint: tenant,
        reason: 'TENANT_ACTIVE_OVERRIDE',
        precedenceTrace: ['tenant-active'],
      };
    }

    const platformCandidates = await this.#repository.listActiveForWorkType({
      scope: { type: 'PLATFORM' },
      workTypeKey: context.workTypeKey,
    });
    const platform = exactlyOneOrNone(
      platformCandidates,
      'platform',
      context.workTypeKey,
    );
    if (platform !== null) {
      return {
        blueprint: platform,
        reason: 'PLATFORM_ACTIVE_DEFAULT',
        precedenceTrace: ['tenant-active:none', 'platform-active'],
      };
    }

    throw new WorkflowBlueprintResolutionError(
      'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND',
      `No ACTIVE workflow blueprint found for work type "${context.workTypeKey}".`,
    );
  }

  async #resolvePinned(
    context: WorkflowBlueprintResolutionContext & { readonly pinned: PinnedWorkflowBlueprint },
  ): Promise<WorkflowBlueprintResolutionResult> {
    const scope: WorkflowBlueprintScope = context.pinned.scope === 'PLATFORM'
      ? { type: 'PLATFORM' }
      : { type: 'TENANT', tenantId: context.tenantId };

    const blueprint = await this.#repository.findByIdentity({
      scope,
      identity: {
        blueprintKey: context.pinned.blueprintKey,
        version: context.pinned.version,
      },
    });

    if (blueprint === null) {
      throw new WorkflowBlueprintResolutionError(
        'WORKFLOW_BLUEPRINT_PIN_NOT_FOUND',
        `Pinned ${context.pinned.scope} workflow blueprint ${context.pinned.blueprintKey}@${context.pinned.version} was not found.`,
      );
    }
    if (blueprint.workTypeKey !== context.workTypeKey) {
      throw new WorkflowBlueprintResolutionError(
        'WORKFLOW_BLUEPRINT_PIN_WORK_TYPE_MISMATCH',
        `Pinned workflow blueprint belongs to work type "${blueprint.workTypeKey}", not "${context.workTypeKey}".`,
      );
    }

    return {
      blueprint,
      reason: 'EXPLICIT_PIN',
      precedenceTrace: [`explicit-pin:${context.pinned.scope.toLowerCase()}`],
    };
  }
}

function exactlyOneOrNone(
  candidates: readonly WorkflowBlueprintDefinition[],
  scope: string,
  workTypeKey: string,
): WorkflowBlueprintDefinition | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  throw new WorkflowBlueprintResolutionError(
    'WORKFLOW_BLUEPRINT_ACTIVE_AMBIGUOUS',
    `Multiple ACTIVE ${scope} workflow blueprints found for work type "${workTypeKey}".`,
  );
}
