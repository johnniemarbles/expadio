import type { PoolClient } from 'pg';

/**
 * Per-subject approval-authority grants (monetary ceiling, org scope, delegation
 * provenance). Read by the decision-capture authority provider to satisfy a
 * stage's authority requirements. The caller passes a client already bound to
 * the tenant RLS context.
 */

export interface AuthorityGrant {
  readonly dimensionKey: string;
  readonly thresholdMinorUnits: number | null;
  readonly currency: string | null;
  readonly scopeType: 'TENANT' | 'ORGANIZATION';
  readonly scopeEntityId: string | null;
  readonly delegatedFromSubjectId: string | null;
}

/** The subject's currently effective, ACTIVE authority grants. */
export async function resolveAuthorityGrants(client: PoolClient, subjectId: string): Promise<AuthorityGrant[]> {
  const result = await client.query(
    `SELECT dimension_key, threshold_minor_units, currency, scope_type, scope_entity_id, delegated_from_subject_id
       FROM platform.workflow_authority_grants
      WHERE subject_id = $1
        AND status = 'ACTIVE'
        AND effective_from <= now()
        AND (effective_until IS NULL OR effective_until > now())`,
    [subjectId],
  );
  return result.rows.map((row): AuthorityGrant => ({
    dimensionKey: row.dimension_key,
    thresholdMinorUnits: row.threshold_minor_units === null || row.threshold_minor_units === undefined ? null : Number(row.threshold_minor_units),
    currency: row.currency ?? null,
    scopeType: row.scope_type,
    scopeEntityId: row.scope_entity_id ?? null,
    delegatedFromSubjectId: row.delegated_from_subject_id ?? null,
  }));
}

export interface GrantAuthorityInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly dimensionKey: string;
  readonly thresholdMinorUnits: number | null;
  readonly currency: string | null;
  readonly scopeType: 'TENANT' | 'ORGANIZATION';
  readonly scopeEntityId: string | null;
  readonly delegatedFromSubjectId: string | null;
  readonly grantedBySubjectId: string;
}

/** Record an authority grant for a subject. */
export async function grantAuthority(client: PoolClient, input: GrantAuthorityInput): Promise<{ grantId: string }> {
  const result = await client.query(
    `INSERT INTO platform.workflow_authority_grants
       (tenant_id, subject_id, dimension_key, threshold_minor_units, currency, scope_type, scope_entity_id, delegated_from_subject_id, granted_by_subject_id)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING grant_id`,
    [
      input.tenantId, input.subjectId, input.dimensionKey, input.thresholdMinorUnits, input.currency,
      input.scopeType, input.scopeEntityId, input.delegatedFromSubjectId, input.grantedBySubjectId,
    ],
  );
  return { grantId: result.rows[0].grant_id };
}
