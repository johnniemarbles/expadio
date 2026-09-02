import type pg from 'pg';
import { validateLeadInput, validateStage, type LeadStage } from '@expadio/lead';

export interface BrandLeadSummary {
  readonly leadId: string;
  readonly title: string;
  readonly stage: LeadStage;
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly source: string | null;
  readonly accountName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toSummary(row: any): BrandLeadSummary {
  return {
    leadId: row.lead_id,
    title: row.title,
    stage: row.stage,
    amountMinorUnits: row.amount_minor_units == null ? null : Number(row.amount_minor_units),
    currency: row.currency,
    source: row.source ?? null,
    accountName: row.account_name ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listBrandLeads(
  client: pg.PoolClient,
  input: { readonly stage?: string | null },
): Promise<readonly BrandLeadSummary[]> {
  const stage = input.stage?.trim().toUpperCase() ?? '';
  if (stage !== '') validateStage(stage);
  const result = await client.query(
    `SELECT l.lead_id, l.title, l.stage, l.amount_minor_units, l.currency, l.source,
            l.created_at, l.updated_at, a.name AS account_name
       FROM platform.crm_leads l
       LEFT JOIN platform.crm_accounts a ON a.account_id = l.account_id
      WHERE ($1 = '' OR l.stage = $1)
      ORDER BY l.created_at DESC
      LIMIT 200`,
    [stage],
  );
  return result.rows.map(toSummary);
}

export async function createBrandLead(
  client: pg.PoolClient,
  input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly actorSubjectId: string;
    readonly body: unknown;
  },
): Promise<BrandLeadSummary> {
  const validated = validateLeadInput(input.body);
  const inserted = await client.query(
    `INSERT INTO platform.crm_leads
       (tenant_id, organization_id, title, stage, amount_minor_units, currency, source, raw_payload, owner_subject_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, '{}'::jsonb, $8)
     RETURNING lead_id, title, stage, amount_minor_units, currency, source,
               created_at, updated_at, NULL::text AS account_name`,
    [
      input.tenantId,
      input.organizationId,
      validated.title,
      validated.stage,
      validated.amountMinorUnits,
      validated.currency,
      validated.source ?? 'manual',
      input.actorSubjectId,
    ],
  );
  return toSummary(inserted.rows[0]);
}

export async function updateBrandLeadStage(
  client: pg.PoolClient,
  input: { readonly leadId: string; readonly stage: unknown },
): Promise<BrandLeadSummary | null> {
  const stage = validateStage(input.stage);
  const updated = await client.query(
    `UPDATE platform.crm_leads
        SET stage = $2, updated_at = now()
      WHERE lead_id = $1::uuid
      RETURNING lead_id, title, stage, amount_minor_units, currency, source,
                created_at, updated_at, NULL::text AS account_name`,
    [input.leadId, stage],
  );
  return updated.rows[0] ? toSummary(updated.rows[0]) : null;
}
