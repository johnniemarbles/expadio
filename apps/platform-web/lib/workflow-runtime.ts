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
  type WorkflowInstance,
  type WorkflowTransitionIntent,
  type InstantiatedWorkflowBlueprint,
  type WorkflowGateBlocker,
  type WorkflowStageDecisionCommitResult,
} from '@expadio/workflow';

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
}

function stagesOf(instantiated: InstantiatedWorkflowBlueprint): WorkflowStageSummary[] {
  return instantiated.stages.map((stage) => ({
    stageKey: stage.stageKey,
    label: stage.label,
    sequence: stage.sequence,
    decisionRequired: stage.decisionRequired,
    decisionOutcomes: stage.decisionOutcomes,
  }));
}

export type StartWorkflowResult =
  | { readonly ok: true; readonly instance: WorkflowInstance; readonly stages: WorkflowStageSummary[] }
  | { readonly ok: false; readonly reason: 'NO_ACTIVE_BLUEPRINT' };

/**
 * Start a governed workflow instance for a subject (e.g. a CRM case) against the
 * newest ACTIVE platform blueprint for a blueprint key. The instance opens in
 * RUNNING state at the blueprint's first stage.
 */
export async function startWorkflow(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly blueprintKey: string;
  },
): Promise<StartWorkflowResult> {
  const blueprints = new PostgresWorkflowBlueprintRepository(client);
  const versions = await blueprints.listVersions({
    scope: { type: 'PLATFORM' },
    blueprintKey: input.blueprintKey,
  });
  const definition = versions.find((candidate) => candidate.state === 'ACTIVE');
  if (definition === undefined) return { ok: false, reason: 'NO_ACTIVE_BLUEPRINT' };

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
} | null> {
  const instance = await new PostgresWorkflowInstanceRepository(client).findById({
    tenantId: input.tenantId,
    instanceId: input.instanceId,
  });
  if (instance === null) return null;
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
  return { instance, stages, currentDecision };
}

export type RecordDecisionResult =
  | { readonly ok: true; readonly status: 'COMMITTED' | 'ALREADY_RECORDED'; readonly outcome: string }
  | { readonly ok: false; readonly reason: 'CONFLICT'; readonly existingOutcome: string };

/**
 * Record an immutable decision against a workflow stage. One decision per
 * tenant/instance/stage; an exact retry is idempotent, a different decision for
 * the same stage is a conflict (never an overwrite — the table is append-only).
 */
export async function recordCaseDecision(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly instanceId: string;
    readonly workTypeKey: string;
    readonly stageKey: string;
    readonly outcome: string;
    readonly decidedBySubjectId: string;
  },
): Promise<RecordDecisionResult> {
  const repo = new PostgresWorkflowStageDecisionRepository(client);
  const result: WorkflowStageDecisionCommitResult = await repo.record({
    tenantId: input.tenantId,
    instanceId: input.instanceId,
    workTypeKey: input.workTypeKey,
    stageKey: input.stageKey,
    decisionId: randomUUID(),
    outcome: input.outcome,
    decidedBySubjectId: input.decidedBySubjectId,
    decidedAt: new Date().toISOString(),
    code: 'crm.case.decision',
    evidenceRefs: [],
  });
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
    const gate = new WorkflowStageDecisionGateEvaluator(new PostgresWorkflowStageDecisionRepository(client));
    const gateDecision = await gate.evaluate({ instance, blueprint: instantiated, intent, fromStage, toStage });
    if (!gateDecision.allowed) {
      return { ok: false, reason: 'GATE_BLOCKED', blockers: gateDecision.blockers };
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
  return { ok: true, instance: result.instance, stages: stagesOf(instantiated) };
}
