import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PostgresWorkflowBlueprintRepository } from '@expadio/postgres-runtime/workflow';
import { PostgresWorkflowInstanceRepository } from '@expadio/postgres-runtime/workflow-instance';
import { PostgresWorkflowStageDecisionRepository } from '@expadio/postgres-runtime/workflow-decision';
import {
  instantiateWorkflowBlueprint,
  commitWorkflowStageTransition,
  WorkflowTransitionError,
  WorkflowStageDecisionGateEvaluator,
  WorkflowParticipantAssignmentGateEvaluator,
  AuthorityGatedWorkflowDecisionCaptureService,
  RepositoryWorkflowBlueprintResolver,
  WorkflowBlueprintResolutionError,
  type WorkflowInstance,
  type WorkflowIndustryPackProvenance,
  type WorkflowTransitionIntent,
  type InstantiatedWorkflowBlueprint,
  type WorkflowBlueprintDefinition,
  type WorkflowGateBlocker,
} from '@expadio/workflow';
import { RoleAndSeparationOfDutiesAuthorityProvider } from './workflow-authority';
import { resolveGoverningRole } from './crm-authz';
import { resolveAuthorityGrants } from './workflow-authority-grants';
import { deriveAuthorityRequirements } from './workflow-authority-derivation';
import { PostgresParticipantAssignmentProvider, listAssignments, type AssignmentSummary } from './workflow-participants';
import { CrmCaseConditionEvaluator } from './workflow-conditions';

/**
 * The Decision Fabric transition runtime, wired for application routes.
 *
 * The pure domain (@expadio/workflow) and the persistence adapters
 * (@expadio/postgres-runtime) already exist and are tested; this is the thin
 * seam that lets a governed HTTP route start a workflow instance for a business
 * entity and advance it through the blueprint's stages. The instance table is
 * mutable under RLS, while every stage move is written as an append-only
 * transition row — so the history is a tamper-evident record by construction.
 *
 * The caller must pass a client that already has the tenant RLS context bound
 * (i.e. from withTenantClient); every query below is tenant-scoped by that GUC.
 */

export interface WorkflowStageSummary {
  readonly stageKey: string;
  readonly label: string;
  readonly sequence: number;
  readonly decisionRequired: boolean;
  readonly decisionOutcomes: readonly string[];
  readonly requiredParticipantKeys: readonly string[];
}

function stagesOf(instantiated: InstantiatedWorkflowBlueprint): WorkflowStageSummary[] {
  return instantiated.stages.map((stage) => ({
    stageKey: stage.stageKey,
    label: stage.label,
    sequence: stage.sequence,
    decisionRequired: stage.decisionRequired,
    decisionOutcomes: stage.decisionOutcomes,
    requiredParticipantKeys: stage.requiredParticipantKeys,
  }));
}

export type StartWorkflowResult =
  | { readonly ok: true; readonly instance: WorkflowInstance; readonly stages: WorkflowStageSummary[] }
  | { readonly ok: false; readonly reason: 'NO_ACTIVE_BLUEPRINT' };

/**
 * Start a governed workflow instance for a subject (e.g. a CRM case) against the
 * ACTIVE blueprint for its work type. The blueprint resolver prefers this
 * tenant's ACTIVE customization over the platform default, so a tenant that has
 * authored and published its own blueprint runs cases on its own lifecycle; a
 * tenant that has not falls back to the platform default. The instance opens in
 * RUNNING state at the blueprint's first stage and pins the resolved blueprint's
 * scope, so every later read resolves the exact same definition.
 */
export async function startWorkflow(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly blueprintKey: string;
    readonly industryPackProvenance?: WorkflowIndustryPackProvenance;
  },
): Promise<StartWorkflowResult> {
  const blueprints = new PostgresWorkflowBlueprintRepository(client);
  const resolver = new RepositoryWorkflowBlueprintResolver(blueprints);
  let definition: WorkflowBlueprintDefinition;
  try {
    ({ blueprint: definition } = await resolver.resolve({
      tenantId: input.tenantId,
      workTypeKey: input.blueprintKey,
    }));
  } catch (error) {
    if (error instanceof WorkflowBlueprintResolutionError && error.code === 'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND') {
      return { ok: false, reason: 'NO_ACTIVE_BLUEPRINT' };
    }
    throw error;
  }

  const instantiated = instantiateWorkflowBlueprint({ blueprint: definition });
  const firstStage = instantiated.stages[0]?.stageKey;
  const now = new Date().toISOString();

  const instance: WorkflowInstance = {
    instanceId: randomUUID(),
    tenantId: input.tenantId,
    workTypeKey: definition.workTypeKey,
    subject: { type: input.subjectType, id: input.subjectId },
    blueprint: {
      blueprintKey: definition.blueprintKey,
      version: definition.version,
      scope: instantiated.scope,
    },
    ...(input.industryPackProvenance === undefined
      ? {}
      : { industryPackProvenance: input.industryPackProvenance }),
    state: 'RUNNING',
    ...(firstStage === undefined ? {} : { currentStageKey: firstStage }),
    revision: 0,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };

  const created = await new PostgresWorkflowInstanceRepository(client).create(instance);
  return { ok: true, instance: created, stages: stagesOf(instantiated) };
}

export interface CurrentDecision {
  readonly stageKey: string;
  readonly outcome: string;
  readonly decidedBySubjectId: string;
  readonly decidedAt: string;
}

/**
 * Load an existing instance, its blueprint's stage list, and the decision (if
 * any) recorded against the current stage — enough for a surface to know whether
 * the current stage is gated and already decided.
 */
export async function describeWorkflow(
  client: PoolClient,
  input: { readonly tenantId: string; readonly instanceId: string },
): Promise<{
  readonly instance: WorkflowInstance;
  readonly stages: WorkflowStageSummary[];
  readonly currentDecision: CurrentDecision | null;
  readonly assignments: AssignmentSummary[];
} | null> {
  const instance = await new PostgresWorkflowInstanceRepository(client).findById({
    tenantId: input.tenantId,
    instanceId: input.instanceId,
  });
  if (instance === null) return null;
  const assignments = await listAssignments(client, { tenantId: input.tenantId, instanceId: input.instanceId });
  const definition = await new PostgresWorkflowBlueprintRepository(client).findByIdentity({
    scope: instance.blueprint.scope === 'TENANT'
      ? { type: 'TENANT', tenantId: input.tenantId }
      : { type: 'PLATFORM' },
    identity: { blueprintKey: instance.blueprint.blueprintKey, version: instance.blueprint.version },
  });
  const stages = definition === null ? [] : stagesOf(instantiateWorkflowBlueprint({ blueprint: definition }));

  let currentDecision: CurrentDecision | null = null;
  if (instance.currentStageKey !== undefined) {
    const recorded = await new PostgresWorkflowStageDecisionRepository(client).resolve({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      workTypeKey: instance.workTypeKey,
      stageKey: instance.currentStageKey,
    });
    if (recorded !== null && recorded.outcome !== undefined && recorded.decidedBySubjectId !== undefined && recorded.decidedAt !== undefined) {
      currentDecision = {
        stageKey: recorded.stageKey,
        outcome: recorded.outcome,
        decidedBySubjectId: recorded.decidedBySubjectId,
        decidedAt: recorded.decidedAt,
      };
    }
  }
  return { instance, stages, currentDecision, assignments };
}

export interface WorkflowHistoryTransition {
  readonly kind: 'TRANSITION';
  readonly at: string;
  readonly revision: number;
  readonly fromStageKey: string | null;
  readonly toStageKey: string;
  readonly bySubjectId: string;
  readonly reason: string | null;
}

export interface WorkflowHistoryDecision {
  readonly kind: 'DECISION';
  readonly at: string;
  readonly stageKey: string;
  readonly outcome: string;
  readonly bySubjectId: string;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkflowHistoryEntry = WorkflowHistoryTransition | WorkflowHistoryDecision;

/**
 * The full governed trace for an instance: every append-only stage transition
 * and every immutable stage decision, merged into one chronological timeline.
 * Read-only and tenant-scoped by the bound RLS context.
 */
export async function loadCaseWorkflowHistory(
  client: PoolClient,
  input: { readonly tenantId: string; readonly instanceId: string },
): Promise<WorkflowHistoryEntry[]> {
  const [transitions, decisions] = await Promise.all([
    client.query(
      `SELECT transitioned_at, revision, from_stage_key, to_stage_key, transitioned_by_subject_id, reason
         FROM platform.workflow_instance_transitions
        WHERE tenant_id = $1::uuid AND instance_id = $2::uuid
        ORDER BY revision ASC`,
      [input.tenantId, input.instanceId],
    ),
    client.query(
      `SELECT decided_at, stage_key, outcome, decided_by_subject_id, code, evidence_refs
         FROM platform.workflow_stage_decisions
        WHERE tenant_id = $1::uuid AND instance_id = $2::uuid
        ORDER BY decided_at ASC`,
      [input.tenantId, input.instanceId],
    ),
  ]);

  const entries: WorkflowHistoryEntry[] = [
    ...transitions.rows.map((row): WorkflowHistoryTransition => ({
      kind: 'TRANSITION',
      at: new Date(row.transitioned_at).toISOString(),
      revision: row.revision,
      fromStageKey: row.from_stage_key ?? null,
      toStageKey: row.to_stage_key,
      bySubjectId: row.transitioned_by_subject_id,
      reason: row.reason ?? null,
    })),
    ...decisions.rows.map((row): WorkflowHistoryDecision => ({
      kind: 'DECISION',
      at: new Date(row.decided_at).toISOString(),
      stageKey: row.stage_key,
      outcome: row.outcome,
      bySubjectId: row.decided_by_subject_id,
      code: row.code,
      evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
    })),
  ];
  // Chronological; a decision and the transition it unlocks can share a moment,
  // so a decision sorts before the transition at an equal timestamp.
  entries.sort((a, b) => (a.at === b.at ? (a.kind === 'DECISION' ? -1 : 1) : a.at < b.at ? -1 : 1));
  return entries;
}

export type RecordDecisionResult =
  | { readonly ok: true; readonly status: 'COMMITTED' | 'ALREADY_RECORDED'; readonly outcome: string }
  | { readonly ok: false; readonly reason: 'CONFLICT'; readonly existingOutcome: string }
  | { readonly ok: false; readonly reason: 'AUTHORITY_DENIED'; readonly code: string; readonly message: string };

/** The subject who advanced the instance into a given stage (its maker), if any. */
export async function makerForStage(
  client: PoolClient,
  input: { readonly tenantId: string; readonly instanceId: string; readonly stageKey: string },
): Promise<string | null> {
  const result = await client.query(
    `SELECT transitioned_by_subject_id
       FROM platform.workflow_instance_transitions
      WHERE tenant_id = $1::uuid AND instance_id = $2::uuid AND to_stage_key = $3
      ORDER BY revision DESC
      LIMIT 1`,
    [input.tenantId, input.instanceId, input.stageKey],
  );
  return result.rows[0]?.transitioned_by_subject_id ?? null;
}

/**
 * Record an immutable decision against a workflow stage, through the authority
 * gate. Role, separation of duties, and any authority requirements (e.g. a
 * monetary threshold from the case's agreements) are enforced first: a denied
 * approval never reaches the immutable table. One decision per stage; an exact
 * retry is idempotent, a different decision is a conflict (never an overwrite).
 */
export async function recordCaseDecision(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly instanceId: string;
    readonly workTypeKey: string;
    readonly stageKey: string;
    readonly outcome: string;
    readonly approverSubjectId: string;
    readonly makerSubjectId: string | null;
  },
): Promise<RecordDecisionResult> {
  // Separation of duties fails closed: if the maker (who advanced the subject
  // into this stage) is unknown, four-eyes cannot be verified — do not coerce
  // it to an empty string and let the check pass by default. A decision-required
  // stage is always entered via a transition, so a null maker means a
  // misconfigured blueprint (e.g. a decision-required first stage), not a valid
  // decision.
  if (input.makerSubjectId === null) {
    return {
      ok: false,
      reason: 'AUTHORITY_DENIED',
      code: 'WORKFLOW_SOD_MAKER_UNKNOWN',
      message: 'Cannot determine who advanced this subject into the stage, so separation of duties cannot be verified.',
    };
  }

  // The authority requirements are derived by the subject's work type through
  // the registered deriver (crm.case → monetary threshold from its agreements);
  // a work type with no deriver is gated by role and separation of duties alone.
  const requirements = await deriveAuthorityRequirements(client, {
    tenantId: input.tenantId,
    instanceId: input.instanceId,
    workTypeKey: input.workTypeKey,
  });

  const service = new AuthorityGatedWorkflowDecisionCaptureService(
    new RoleAndSeparationOfDutiesAuthorityProvider(
      (subjectId) => resolveGoverningRole(client, subjectId),
      (subjectId) => resolveAuthorityGrants(client, subjectId),
    ),
    new PostgresWorkflowStageDecisionRepository(client),
  );
  const result = await service.capture({
    tenantId: input.tenantId,
    instanceId: input.instanceId,
    workTypeKey: input.workTypeKey,
    stageKey: input.stageKey,
    decisionId: randomUUID(),
    outcome: input.outcome,
    requestedBySubjectId: input.makerSubjectId ?? '',
    approverSubjectId: input.approverSubjectId,
    authorityRequirements: requirements,
    decidedAt: new Date().toISOString(),
    code: 'crm.case.decision',
    evidenceRefs: [],
  });

  if (result.status === 'AUTHORITY_DENIED') {
    return { ok: false, reason: 'AUTHORITY_DENIED', code: result.code, message: result.reason };
  }
  if (result.status === 'CONFLICT') {
    return { ok: false, reason: 'CONFLICT', existingOutcome: result.existing.outcome ?? '' };
  }
  return { ok: true, status: result.status, outcome: result.decision.outcome ?? input.outcome };
}

export type TransitionResult =
  | { readonly ok: true; readonly instance: WorkflowInstance; readonly stages: WorkflowStageSummary[] }
  | { readonly ok: false; readonly reason: 'INSTANCE_NOT_FOUND' | 'NO_ACTIVE_BLUEPRINT' | 'REVISION_CONFLICT' }
  | { readonly ok: false; readonly reason: 'TRANSITION_REJECTED'; readonly code: string; readonly message: string }
  | { readonly ok: false; readonly reason: 'GATE_BLOCKED'; readonly blockers: readonly WorkflowGateBlocker[] };

/**
 * Advance an instance to a target stage. The pure domain enforces revision,
 * blueprint, and stage-membership invariants; the adapter commits the instance
 * mutation and appends the transition row atomically under optimistic
 * concurrency.
 */
export async function transitionWorkflow(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly instanceId: string;
    readonly expectedRevision: number;
    readonly toStageKey: string;
    readonly requestedBySubjectId: string;
    readonly reason?: string;
  },
): Promise<TransitionResult> {
  const instanceRepo = new PostgresWorkflowInstanceRepository(client);
  const instance = await instanceRepo.findById({ tenantId: input.tenantId, instanceId: input.instanceId });
  if (instance === null) return { ok: false, reason: 'INSTANCE_NOT_FOUND' };

  const blueprints = new PostgresWorkflowBlueprintRepository(client);
  const definition = await blueprints.findByIdentity({
    scope: instance.blueprint.scope === 'TENANT'
      ? { type: 'TENANT', tenantId: input.tenantId }
      : { type: 'PLATFORM' },
    identity: { blueprintKey: instance.blueprint.blueprintKey, version: instance.blueprint.version },
  });
  if (definition === null) return { ok: false, reason: 'NO_ACTIVE_BLUEPRINT' };

  const instantiated = instantiateWorkflowBlueprint({ blueprint: definition });
  const intent: WorkflowTransitionIntent = {
    instanceId: input.instanceId,
    expectedRevision: input.expectedRevision,
    ...(instance.currentStageKey === undefined ? {} : { fromStageKey: instance.currentStageKey }),
    toStageKey: input.toStageKey,
    requestedBySubjectId: input.requestedBySubjectId,
    requestedAt: new Date().toISOString(),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };

  let computed;
  try {
    computed = commitWorkflowStageTransition({ instance, blueprint: instantiated, intent });
  } catch (error) {
    if (error instanceof WorkflowTransitionError) {
      return { ok: false, reason: 'TRANSITION_REJECTED', code: error.code, message: error.message };
    }
    throw error;
  }

  // Enforce the blueprint's exit gate: leaving a decision-required stage needs a
  // recorded decision with an allowed outcome. The gate and its evidence live in
  // @expadio/workflow; here we back it with the immutable decision table.
  const toStage = instantiated.stages.find((stage) => stage.stageKey === input.toStageKey);
  const fromStage = instance.currentStageKey === undefined
    ? undefined
    : instantiated.stages.find((stage) => stage.stageKey === instance.currentStageKey);
  if (toStage !== undefined) {
    // Condition gate first (domain order: exit conditions of the current stage,
    // then entry conditions of the target). Fails closed on unknown conditions.
    const conditionEvaluator = new CrmCaseConditionEvaluator(client);
    const conditionBlockers: WorkflowGateBlocker[] = [];
    for (const condition of fromStage?.exitConditions ?? []) {
      const r = await conditionEvaluator.evaluate({
        condition,
        context: { tenantId: input.tenantId, instanceId: input.instanceId, workTypeKey: instance.workTypeKey, stageKey: fromStage!.stageKey, phase: 'EXIT' },
      });
      if (!r.satisfied) conditionBlockers.push({ kind: 'EXIT_CONDITION', code: r.code, key: condition.type });
    }
    for (const condition of toStage.entryConditions) {
      const r = await conditionEvaluator.evaluate({
        condition,
        context: { tenantId: input.tenantId, instanceId: input.instanceId, workTypeKey: instance.workTypeKey, stageKey: toStage.stageKey, phase: 'ENTRY' },
      });
      if (!r.satisfied) conditionBlockers.push({ kind: 'ENTRY_CONDITION', code: r.code, key: condition.type });
    }
    if (conditionBlockers.length > 0) {
      return { ok: false, reason: 'GATE_BLOCKED', blockers: conditionBlockers };
    }

    const decisionGate = new WorkflowStageDecisionGateEvaluator(new PostgresWorkflowStageDecisionRepository(client));
    const decisionResult = await decisionGate.evaluate({ instance, blueprint: instantiated, intent, fromStage, toStage });
    if (!decisionResult.allowed) {
      return { ok: false, reason: 'GATE_BLOCKED', blockers: decisionResult.blockers };
    }

    // Participant gate: entering a stage requires its named participant slots to
    // be filled. Missing/ineligible/unavailable slots block the move.
    const participantGate = new WorkflowParticipantAssignmentGateEvaluator(new PostgresParticipantAssignmentProvider(client));
    const participantResult = await participantGate.evaluate({ instance, blueprint: instantiated, intent, fromStage, toStage });
    if (!participantResult.allowed) {
      return { ok: false, reason: 'GATE_BLOCKED', blockers: participantResult.blockers };
    }
  }

  const result = await instanceRepo.commitTransition({
    expectedRevision: input.expectedRevision,
    instance: computed.instance,
    transition: computed.record,
  });
  if (!result.committed) {
    return { ok: false, reason: result.reason === 'INSTANCE_NOT_FOUND' ? 'INSTANCE_NOT_FOUND' : 'REVISION_CONFLICT' };
  }

  // Auto-complete: landing on the blueprint's terminal stage ends the instance.
  // The pure transition domain only moves stages (it never sets COMPLETED), so
  // completion is a governed lifecycle event recorded as its own append-only
  // transition (RUNNING → COMPLETED, same stage) rather than a silent update.
  const terminalStageKey = instantiated.stages[instantiated.stages.length - 1]?.stageKey;
  const moved = result.instance;
  if (terminalStageKey !== undefined && moved.currentStageKey === terminalStageKey && moved.state === 'RUNNING') {
    const now = new Date().toISOString();
    const completed: WorkflowInstance = { ...moved, state: 'COMPLETED', revision: moved.revision + 1, completedAt: now, updatedAt: now };
    const completion = await instanceRepo.commitTransition({
      expectedRevision: moved.revision,
      instance: completed,
      transition: {
        instanceId: moved.instanceId,
        ...(moved.currentStageKey === undefined ? {} : { fromStageKey: moved.currentStageKey }),
        toStageKey: terminalStageKey,
        fromState: 'RUNNING',
        toState: 'COMPLETED',
        revision: moved.revision + 1,
        transitionedBySubjectId: input.requestedBySubjectId,
        transitionedAt: now,
        reason: 'auto-complete: terminal stage',
      },
    });
    if (completion.committed) {
      return { ok: true, instance: completion.instance, stages: stagesOf(instantiated) };
    }
    // A concurrent write beat the completion; the stage move still stands.
  }

  return { ok: true, instance: result.instance, stages: stagesOf(instantiated) };
}
