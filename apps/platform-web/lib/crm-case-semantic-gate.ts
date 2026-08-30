import type { PoolClient } from 'pg';
import {
  CRM_CASE_STAGES,
  IndustryPackRuntimeResolutionError,
  evaluateCaseStageSemantics,
  resolveCaseStageSemantics,
  type CaseRelationshipConcept,
  type CrmCaseStage,
} from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import { PostgresWorkflowStageDecisionRepository } from '@expadio/postgres-runtime/workflow-decision';
import type { WorkflowGateBlocker } from '@expadio/workflow';

interface CaseSemanticRow {
  readonly attributes: Readonly<Record<string, unknown>> | null;
  readonly account_id: string | null;
  readonly contact_id: string | null;
  readonly industry_pack_vertical_key: string | null;
  readonly has_active_agreement: boolean;
}

export interface CrmCaseSemanticTransitionInput {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly caseId: string;
  readonly workTypeKey: string;
  readonly fromStageKey?: string;
  readonly toStageKey: string;
}

/**
 * CRM adapter for Pack-declared case semantics.
 *
 * The workflow engine remains vertical-neutral: this seam resolves the active
 * executable Industry Pack, converts CRM storage into canonical case facts and
 * maps semantic failures back to generic workflow gate blockers.
 */
export async function evaluateCrmCaseSemanticTransition(
  client: PoolClient,
  input: CrmCaseSemanticTransitionInput,
): Promise<readonly WorkflowGateBlocker[]> {
  if (input.workTypeKey !== 'crm.case') return [];

  const caseResult = await client.query<CaseSemanticRow>(
    `SELECT c.attributes, c.account_id, c.contact_id, c.industry_pack_vertical_key,
            EXISTS (
              SELECT 1
                FROM platform.entity_relationships relationship
                JOIN platform.crm_agreements agreement
                  ON agreement.tenant_id = relationship.tenant_id
                 AND agreement.agreement_id::text = relationship.target_entity_id
               WHERE relationship.tenant_id = c.tenant_id
                 AND relationship.source_entity_type = 'crm.case'
                 AND relationship.source_entity_id = c.case_id::text
                 AND relationship.relationship_key = 'care_plan'
                 AND relationship.target_entity_type = 'crm.agreement'
                 AND relationship.status = 'ACTIVE'
                 AND relationship.valid_until IS NULL
                 AND agreement.status = 'ACTIVE'
            ) AS has_active_agreement
       FROM platform.crm_cases c
      WHERE c.tenant_id = $1::uuid
        AND c.case_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.caseId],
  );
  const row = caseResult.rows[0];
  if (row === undefined) {
    return [{
      kind: 'POLICY',
      code: 'CASE_SEMANTIC_CASE_NOT_FOUND',
      key: input.caseId,
      message: 'The CRM case behind this workflow instance could not be resolved.',
    }];
  }

  let runtimePack;
  try {
    runtimePack = await new PostgresIndustryPackRuntimeResolver(client).resolve({
      tenantId: input.tenantId,
      verticalKey: row.industry_pack_vertical_key,
    });
  } catch (error) {
    if (error instanceof IndustryPackRuntimeResolutionError) {
      return [{
        kind: 'POLICY',
        code: 'CASE_SEMANTIC_PACK_NOT_RESOLVED',
        key: row.industry_pack_vertical_key ?? 'neutral',
        message: error.message,
      }];
    }
    throw error;
  }

  const semantics = resolveCaseStageSemantics(runtimePack.pack);
  if (semantics.requirements.length === 0) return [];

  const relationships: CaseRelationshipConcept[] = [];
  if (row.account_id !== null) relationships.push('crm.account');
  if (row.contact_id !== null) relationships.push('crm.contact');
  if (row.has_active_agreement) relationships.push('crm.agreement');

  const decisionRepository = new PostgresWorkflowStageDecisionRepository(client);
  const evaluatePhase = async (
    stageKey: string | undefined,
    phase: 'ENTRY' | 'EXIT',
  ): Promise<WorkflowGateBlocker[]> => {
    if (stageKey === undefined || !isCrmCaseStage(stageKey)) return [];

    const decision = await decisionRepository.resolve({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      workTypeKey: input.workTypeKey,
      stageKey,
    });
    const decisionOutcomes = decision?.outcome === undefined ? [] : [decision.outcome];
    const result = evaluateCaseStageSemantics(semantics, {
      stageKey,
      phase,
      attributes: row.attributes ?? {},
      relationships,
      decisionOutcomes,
    });

    return result.blockers.map((blocker) => ({
      kind: phase === 'EXIT' ? 'EXIT_CONDITION' : 'ENTRY_CONDITION',
      code: blocker.code,
      key: blocker.key,
      message: blocker.message,
    }));
  };

  return [
    ...(await evaluatePhase(input.fromStageKey, 'EXIT')),
    ...(await evaluatePhase(input.toStageKey, 'ENTRY')),
  ];
}

function isCrmCaseStage(stageKey: string): stageKey is CrmCaseStage {
  return (CRM_CASE_STAGES as readonly string[]).includes(stageKey);
}
