import type { PoolClient } from 'pg';
import type {
  WorkflowConditionEvaluator,
  WorkflowConditionEvaluationContext,
  WorkflowConditionEvaluationResult,
  WorkflowCondition,
} from '@expadio/workflow';

/**
 * Evaluates blueprint-declared entry/exit conditions for CRM cases against the
 * case's own data. The universal workflow package never depends on the crm
 * schema; this app-side evaluator is the injected port that bridges the two.
 *
 * Fails closed: an unrecognized condition type blocks the transition rather than
 * silently passing — a governance surface must not skip a rule it cannot read.
 *
 * The caller passes a client already bound to the tenant RLS context.
 */
export class CrmCaseConditionEvaluator implements WorkflowConditionEvaluator {
  readonly #client: PoolClient;
  constructor(client: PoolClient) {
    this.#client = client;
  }

  async evaluate(input: {
    readonly condition: WorkflowCondition;
    readonly context: WorkflowConditionEvaluationContext;
  }): Promise<WorkflowConditionEvaluationResult> {
    const type = input.condition.type.trim();

    // Resolve the case behind this workflow instance (subject_id = case_id).
    const row = await this.#client.query(
      `SELECT c.account_id, c.description
         FROM platform.crm_cases c
         JOIN platform.workflow_instances wi ON wi.subject_id = c.case_id::text
        WHERE wi.instance_id = $1::uuid AND wi.tenant_id = $2::uuid
        LIMIT 1`,
      [input.context.instanceId, input.context.tenantId],
    );
    const caseRow = row.rows[0];
    if (caseRow === undefined) {
      return { satisfied: false, code: 'CASE_NOT_FOUND', evidenceRefs: [`condition:${type}:no-subject`] };
    }

    switch (type) {
      case 'case.has_account': {
        const ok = caseRow.account_id !== null && caseRow.account_id !== undefined;
        return {
          satisfied: ok,
          code: ok ? 'CASE_HAS_ACCOUNT' : 'CASE_ACCOUNT_MISSING',
          evidenceRefs: [`condition:${type}:${ok ? 'met' : 'unmet'}`],
        };
      }
      case 'case.has_description': {
        const ok = typeof caseRow.description === 'string' && caseRow.description.trim() !== '';
        return {
          satisfied: ok,
          code: ok ? 'CASE_HAS_DESCRIPTION' : 'CASE_DESCRIPTION_MISSING',
          evidenceRefs: [`condition:${type}:${ok ? 'met' : 'unmet'}`],
        };
      }
      default:
        return { satisfied: false, code: 'WORKFLOW_CONDITION_UNKNOWN', evidenceRefs: [`condition:${type}:unknown`] };
    }
  }
}
