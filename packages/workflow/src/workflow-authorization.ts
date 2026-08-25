export interface WorkflowTransitionAuthorizationContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly actorSubjectId: string;
  readonly fromStageKey?: string;
  readonly toStageKey: string;
  /** Stable authorization action key; policy adapters may map this further. */
  readonly action: string;
}

export interface WorkflowTransitionAuthorizationDecision {
  readonly allowed: boolean;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

/**
 * Provider-neutral boundary between the workflow engine and EXPADIO
 * authorization/policy. The workflow runtime does not inspect roles, scopes,
 * relationships, entitlements or SoD rules directly.
 */
export interface WorkflowTransitionAuthorizationProvider {
  authorize(
    context: WorkflowTransitionAuthorizationContext,
  ): Promise<WorkflowTransitionAuthorizationDecision>;
}
