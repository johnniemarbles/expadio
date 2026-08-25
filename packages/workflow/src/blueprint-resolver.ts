import type {
  PinnedWorkflowBlueprint,
  WorkflowBlueprintDefinition,
} from './index.ts';

export type WorkflowBlueprintResolutionReason =
  | 'TENANT_ACTIVE_OVERRIDE'
  | 'PLATFORM_ACTIVE_DEFAULT'
  | 'EXPLICIT_PIN';

export interface WorkflowBlueprintResolutionContext {
  readonly tenantId: string;
  readonly workTypeKey: string;
  /**
   * When present, the resolver must return this exact blueprint identity or
   * fail. This is used after a workflow boundary has frozen a version.
   */
  readonly pinned?: PinnedWorkflowBlueprint;
}

export interface WorkflowBlueprintResolutionResult {
  readonly blueprint: WorkflowBlueprintDefinition;
  readonly reason: WorkflowBlueprintResolutionReason;
  readonly precedenceTrace: readonly string[];
}

/**
 * Resolves an executable ACTIVE workflow blueprint for a tenant/work type.
 *
 * Precedence contract:
 * 1. an explicit pin wins and must resolve exactly;
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
    | 'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND';

  constructor(
    code:
      | 'WORKFLOW_BLUEPRINT_PIN_NOT_FOUND'
      | 'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowBlueprintResolutionError';
    this.code = code;
  }
}
