import type { PoolClient } from 'pg';
import type {
  DentexTreatmentReadiness,
  DentexTreatmentRequirement,
  DentexTreatmentStage,
} from '@expadio/dentex';
import {
  resolveCaseStageSemantics,
  resolveCaseWorkflowVocabulary,
} from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import { evaluateCrmCaseSemanticTransition } from './crm-case-semantic-gate';
import { describeWorkflow } from './workflow-runtime';
import { loadDentexTreatmentWorkspace } from './dentex-treatment-projection';

function stage(value: string | undefined | null): DentexTreatmentStage | null {
  if (value === 'INTAKE' || value === 'IN_PROGRESS' || value === 'REVIEW' || value === 'RESOLVED') {
    return value;
  }
  return null;
}

function relationshipLabel(key: string): string {
  switch (key) {
    case 'crm.contact': return 'Patient linked';
    case 'crm.account': return 'Practice linked';
    case 'crm.agreement': return 'Care Plan attached';
    default: return `${key} linked`;
  }
}

function relationshipHint(key: string): string | null {
  switch (key) {
    case 'crm.contact': return 'Link the Patient before advancing.';
    case 'crm.account': return 'Link the Practice before advancing.';
    case 'crm.agreement': return 'Attach an active Care Plan to this Treatment.';
    default: return null;
  }
}

function attributeLabel(key: string): string {
  switch (key) {
    case 'procedureCode': return 'Performed procedure recorded';
    case 'tooth': return 'Tooth / quadrant recorded';
    case 'urgency': return 'Urgency recorded';
    default: return `${key} recorded`;
  }
}

function attributeHint(key: string): string | null {
  if (key === 'procedureCode') return 'Record the performed procedure before Clinical Review.';
  return null;
}

function blocked(
  blockers: readonly { readonly code: string; readonly key?: string }[],
  code: string,
  key: string,
): boolean {
  return blockers.some((item) => item.code === code && item.key === key);
}

/**
 * Read-only DENTEX readiness projection.
 *
 * Requirements are generated from the active Industry Pack's executable
 * semantics plus the live workflow descriptor. The UX therefore renders the
 * same rules the transition runtime enforces instead of maintaining a second
 * client-side rules engine.
 */
export async function loadDentexTreatmentReadiness(
  client: PoolClient,
  input: { readonly tenantId: string; readonly treatmentId: string },
): Promise<DentexTreatmentReadiness | null> {
  const workspace = await loadDentexTreatmentWorkspace(client, input);
  if (workspace === null) return null;

  if (workspace.workflow === null) {
    return {
      workflowStarted: false,
      state: null,
      currentStage: null,
      currentStageLabel: null,
      nextStage: null,
      nextStageLabel: null,
      revision: null,
      stages: [],
      requirements: [],
      canAdvance: false,
      currentDecision: null,
    };
  }

  const described = await describeWorkflow(client, {
    tenantId: input.tenantId,
    instanceId: workspace.workflow.instanceId,
  });
  if (described === null) {
    return {
      workflowStarted: false,
      state: null,
      currentStage: null,
      currentStageLabel: null,
      nextStage: null,
      nextStageLabel: null,
      revision: null,
      stages: [],
      requirements: [],
      canAdvance: false,
      currentDecision: null,
    };
  }

  const runtimePack = await new PostgresIndustryPackRuntimeResolver(client).resolve({
    tenantId: input.tenantId,
    verticalKey: 'dentex',
  });
  const vocabulary = resolveCaseWorkflowVocabulary(runtimePack.pack);
  const semantics = resolveCaseStageSemantics(runtimePack.pack);

  const orderedStages = [...described.stages].sort((a, b) => a.sequence - b.sequence);
  const currentStageKey = stage(described.instance.currentStageKey);
  const currentIndex = currentStageKey === null
    ? -1
    : orderedStages.findIndex((item) => item.stageKey === currentStageKey);
  const nextDescriptor = currentIndex >= 0 ? orderedStages[currentIndex + 1] : undefined;
  const nextStageKey = stage(nextDescriptor?.stageKey);

  const semanticBlockers = currentStageKey !== null && nextStageKey !== null
    ? await evaluateCrmCaseSemanticTransition(client, {
        tenantId: input.tenantId,
        instanceId: workspace.workflow.instanceId,
        caseId: input.treatmentId,
        workTypeKey: 'crm.case',
        fromStageKey: currentStageKey,
        toStageKey: nextStageKey,
      })
    : [];

  const requirements: DentexTreatmentRequirement[] = [];

  const relevantSemantics = semantics.requirements.filter((requirement) =>
    (requirement.phase === 'EXIT' && requirement.stageKey === currentStageKey)
    || (requirement.phase === 'ENTRY' && requirement.stageKey === nextStageKey)
  );

  for (const requirement of relevantSemantics) {
    for (const key of requirement.requiredRelationships ?? []) {
      requirements.push({
        key: `relationship:${key}`,
        label: relationshipLabel(key),
        kind: 'RELATIONSHIP',
        satisfied: !blocked(
          semanticBlockers,
          'CASE_SEMANTIC_RELATIONSHIP_REQUIRED',
          key,
        ),
        actionHint: relationshipHint(key),
      });
    }

    for (const key of requirement.requiredAttributeKeys ?? []) {
      requirements.push({
        key: `attribute:${key}`,
        label: attributeLabel(key),
        kind: 'ATTRIBUTE',
        satisfied: !blocked(
          semanticBlockers,
          'CASE_SEMANTIC_ATTRIBUTE_REQUIRED',
          key,
        ),
        actionHint: attributeHint(key),
      });
    }

    if ((requirement.requiredDecisionOutcomes ?? []).length > 0) {
      const expected = requirement.requiredDecisionOutcomes ?? [];
      const recorded = described.currentDecision?.outcome;
      requirements.push({
        key: 'decision:current',
        label: expected.includes('APPROVE')
          ? 'Clinical approval recorded'
          : 'Required decision recorded',
        kind: 'DECISION',
        satisfied: recorded !== undefined && expected.includes(recorded),
        actionHint: expected.includes('APPROVE')
          ? 'Record clinical approval before discharge.'
          : 'Record the required decision before advancing.',
      });
    }
  }

  if (nextDescriptor !== undefined) {
    const assigned = new Set(
      described.assignments
        .filter((assignment) =>
          assignment.stageKey === nextDescriptor.stageKey
          && assignment.status === 'ASSIGNED'
        )
        .map((assignment) => assignment.participantKey),
    );

    for (const participantKey of nextDescriptor.requiredParticipantKeys) {
      requirements.push({
        key: `participant:${nextDescriptor.stageKey}:${participantKey}`,
        label: `${participantKey[0]?.toUpperCase() ?? ''}${participantKey.slice(1)} assigned`,
        kind: 'PARTICIPANT',
        satisfied: assigned.has(participantKey),
        actionHint: `Assign the ${participantKey} before entering ${vocabulary.stages[nextStageKey ?? 'INTAKE']}.`,
      });
    }
  }

  const terminal = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(described.instance.state);
  const canAdvance = !terminal
    && nextStageKey !== null
    && requirements.every((item) => item.satisfied);

  return {
    workflowStarted: true,
    state: described.instance.state,
    currentStage: currentStageKey,
    currentStageLabel: currentStageKey === null ? null : vocabulary.stages[currentStageKey],
    nextStage: nextStageKey,
    nextStageLabel: nextStageKey === null ? null : vocabulary.stages[nextStageKey],
    revision: described.instance.revision,
    stages: orderedStages.flatMap((item) => {
      const stageKey = stage(item.stageKey);
      return stageKey === null
        ? []
        : [{
            stageKey,
            label: vocabulary.stages[stageKey],
            sequence: item.sequence,
          }];
    }),
    requirements,
    canAdvance,
    currentDecision: described.currentDecision === null
      ? null
      : { outcome: described.currentDecision.outcome },
  };
}
