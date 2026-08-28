import type { PoolClient } from 'pg';
import type { WorkflowAuthorityRequirement } from '@expadio/workflow';

/**
 * The seam that keeps the decision path work-type-agnostic.
 *
 * The generic runtime records a decision through the authority gate, but *what
 * authority a decision requires* is a per-vertical question — a CRM case's
 * approval threshold comes from its account's agreements; another vertical's
 * would come from somewhere else entirely. Rather than let the runtime name any
 * one vertical, each registers a deriver keyed by its work type. A work type
 * with no registered deriver has no monetary/scope requirement, so its decisions
 * are gated by role and separation of duties alone.
 */
export type AuthorityDeriver = (
  client: PoolClient,
  ctx: { readonly tenantId: string; readonly instanceId: string },
) => Promise<WorkflowAuthorityRequirement[]>;

const derivers = new Map<string, AuthorityDeriver>();

export function registerAuthorityDeriver(workTypeKey: string, deriver: AuthorityDeriver): void {
  derivers.set(workTypeKey, deriver);
}

/** Dispatch to the work type's registered deriver, or no requirement at all. */
export async function deriveAuthorityRequirements(
  client: PoolClient,
  ctx: { readonly tenantId: string; readonly instanceId: string; readonly workTypeKey: string },
): Promise<WorkflowAuthorityRequirement[]> {
  const deriver = derivers.get(ctx.workTypeKey);
  if (deriver === undefined) return [];
  return deriver(client, { tenantId: ctx.tenantId, instanceId: ctx.instanceId });
}

/**
 * CRM cases derive a monetary approval threshold from the case's account: the
 * most valuable ACTIVE agreement sets the ceiling, scoped to the account's
 * organization when present. No account or no agreement → no requirement.
 */
export const crmCaseAuthorityDeriver: AuthorityDeriver = async (client, { tenantId, instanceId }) => {
  const result = await client.query(
    `SELECT a.organization_id,
            g.max_value,
            g.currency
       FROM platform.crm_cases c
       JOIN platform.workflow_instances wi ON wi.subject_id = c.case_id::text
       JOIN platform.crm_accounts a ON a.account_id = c.account_id
       JOIN LATERAL (
         SELECT max(value_minor_units) AS max_value, currency
           FROM platform.crm_agreements
          WHERE account_id = c.account_id AND status = 'ACTIVE' AND value_minor_units IS NOT NULL
          GROUP BY currency
          ORDER BY max(value_minor_units) DESC
          LIMIT 1
       ) g ON true
      WHERE wi.instance_id = $1::uuid AND wi.tenant_id = $2::uuid
      LIMIT 1`,
    [instanceId, tenantId],
  );
  const row = result.rows[0];
  if (row === undefined || row.max_value === null || row.max_value === undefined) return [];
  const orgId = row.organization_id ?? null;
  return [{
    dimensionKey: 'monetary.approval',
    requiredValue: Number(row.max_value),
    unit: row.currency,
    ...(orgId === null ? { scopeType: 'TENANT' } : { scopeType: 'ORGANIZATION', scopeEntityId: orgId }),
  }];
};

registerAuthorityDeriver('crm.case', crmCaseAuthorityDeriver);
