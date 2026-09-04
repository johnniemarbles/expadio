import type pg from 'pg';

export const BRAND_LEAD_STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const;
export type BrandLeadStage = (typeof BRAND_LEAD_STAGES)[number];

function stage(value: unknown): BrandLeadStage {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!BRAND_LEAD_STAGES.includes(normalized as BrandLeadStage)) throw new Error('LEAD_STAGE_INVALID');
  return normalized as BrandLeadStage;
}

const VALID_INTEREST_TYPES = new Set([
  'FRANCHISEE', 'MASTER_FRANCHISEE', 'DISTRIBUTOR', 'AFFILIATE', 'LICENSEE', 'AGENT',
]);
const VALID_OPPORTUNITY_TYPES = new Set([
  'SINGLE_UNIT', 'MULTI_UNIT', 'AREA_DEVELOPMENT', 'CONVERSION', 'RESALE',
  'EXCLUSIVE_DISTRIBUTOR', 'NON_EXCLUSIVE_DISTRIBUTOR', 'MASTER_DISTRIBUTOR', 'SUB_DISTRIBUTOR',
]);

function manualLeadInput(body: unknown) {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};

  const firstName = typeof record.firstName === 'string' && record.firstName.trim()
    ? record.firstName.trim().slice(0, 100)
    : null;
  const lastName = typeof record.lastName === 'string' && record.lastName.trim()
    ? record.lastName.trim().slice(0, 100)
    : null;
  const contactName = [firstName, lastName].filter(Boolean).join(' ') ||
    (typeof record.contactName === 'string' && record.contactName.trim()
      ? record.contactName.trim().slice(0, 200)
      : null);

  const contactEmail = typeof record.contactEmail === 'string' && record.contactEmail.trim()
    ? record.contactEmail.trim().toLowerCase()
    : null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('LEAD_EMAIL_INVALID');
  const contactPhone = typeof record.contactPhone === 'string' && record.contactPhone.trim()
    ? record.contactPhone.trim().slice(0, 50)
    : null;

  const rawInterestType = typeof record.enquiryInterestType === 'string' ? record.enquiryInterestType.trim().toUpperCase() : null;
  const enquiryInterestType = rawInterestType && VALID_INTEREST_TYPES.has(rawInterestType) ? rawInterestType : null;
  const rawOpportunityType = typeof record.enquiryOpportunityType === 'string' ? record.enquiryOpportunityType.trim().toUpperCase() : null;
  const enquiryOpportunityType = rawOpportunityType && VALID_OPPORTUNITY_TYPES.has(rawOpportunityType) ? rawOpportunityType : null;

  const rawCountry = typeof record.countryCode === 'string' ? record.countryCode.trim().toUpperCase() : null;
  const countryCode = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;
  const regionOrState = typeof record.regionOrState === 'string' && record.regionOrState.trim()
    ? record.regionOrState.trim().slice(0, 100) : null;
  const city = typeof record.city === 'string' && record.city.trim()
    ? record.city.trim().slice(0, 100) : null;
  const postalCode = typeof record.postalCode === 'string' && record.postalCode.trim()
    ? record.postalCode.trim().slice(0, 20) : null;

  const enquiryPayload = record.enquiryPayload && typeof record.enquiryPayload === 'object'
    ? record.enquiryPayload as Record<string, unknown>
    : null;

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (title.length < 1 || title.length > 200) throw new Error('LEAD_TITLE_INVALID');
  const leadStage = record.stage == null || record.stage === '' ? 'NEW' : stage(record.stage);
  const currency = typeof record.currency === 'string' && record.currency.trim() !== ''
    ? record.currency.trim().toUpperCase()
    : 'USD';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('LEAD_CURRENCY_INVALID');
  let amountMinorUnits: number | null = null;
  if (record.amountMinorUnits !== undefined && record.amountMinorUnits !== null && record.amountMinorUnits !== '') {
    const parsed = Number(record.amountMinorUnits);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('LEAD_AMOUNT_INVALID');
    amountMinorUnits = parsed;
  }
  return {
    firstName, lastName, contactName, contactEmail, contactPhone,
    enquiryInterestType, enquiryOpportunityType,
    countryCode, regionOrState, city, postalCode, enquiryPayload,
    title, stage: leadStage, currency, amountMinorUnits,
  } as const;
}

export interface BrandLeadSummary {
  readonly leadId: string;
  readonly title: string;
  readonly stage: BrandLeadStage;
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly source: string | null;
  readonly accountName: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly enquiryInterestType: string | null;
  readonly enquiryOpportunityType: string | null;
  readonly countryCode: string | null;
  readonly regionOrState: string | null;
  readonly city: string | null;
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
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    contactName: row.contact_name ?? null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    enquiryInterestType: row.enquiry_interest_type ?? null,
    enquiryOpportunityType: row.enquiry_opportunity_type ?? null,
    countryCode: row.country_code ?? null,
    regionOrState: row.region_or_state ?? null,
    city: row.city ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listBrandLeads(
  client: pg.PoolClient,
  input: { readonly stage?: string | null },
): Promise<readonly BrandLeadSummary[]> {
  const selectedStage = input.stage?.trim().toUpperCase() ?? '';
  if (selectedStage !== '') stage(selectedStage);
  const result = await client.query(
    `SELECT l.lead_id, l.title, l.stage, l.amount_minor_units, l.currency, l.source,
            l.first_name, l.last_name, l.contact_name, l.contact_email, l.contact_phone,
            l.enquiry_interest_type, l.enquiry_opportunity_type,
            l.country_code, l.region_or_state, l.city,
            l.created_at, l.updated_at, a.name AS account_name
       FROM platform.crm_leads l
       LEFT JOIN platform.crm_accounts a ON a.account_id = l.account_id
      WHERE ($1 = '' OR l.stage = $1)
      ORDER BY l.created_at DESC
      LIMIT 200`,
    [selectedStage],
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
  const validated = manualLeadInput(input.body);
  const inserted = await client.query(
    `INSERT INTO platform.crm_leads
       (tenant_id, organization_id, title, stage, amount_minor_units, currency, source,
        first_name, last_name, contact_name, contact_email, contact_phone,
        enquiry_interest_type, enquiry_opportunity_type,
        country_code, region_or_state, city, postal_code, enquiry_payload,
        raw_payload, owner_subject_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'manual',
             $7, $8, $9, $10, $11,
             $12, $13,
             $14, $15, $16, $17, $18::jsonb,
             '{}'::jsonb, $19)
     RETURNING lead_id, title, stage, amount_minor_units, currency, source,
               first_name, last_name, contact_name, contact_email, contact_phone,
               enquiry_interest_type, enquiry_opportunity_type,
               country_code, region_or_state, city,
               created_at, updated_at, NULL::text AS account_name`,
    [
      input.tenantId, input.organizationId, validated.title, validated.stage,
      validated.amountMinorUnits, validated.currency,
      validated.firstName, validated.lastName, validated.contactName,
      validated.contactEmail, validated.contactPhone,
      validated.enquiryInterestType, validated.enquiryOpportunityType,
      validated.countryCode, validated.regionOrState, validated.city,
      validated.postalCode,
      validated.enquiryPayload ? JSON.stringify(validated.enquiryPayload) : null,
      input.actorSubjectId,
    ],
  );
  return toSummary(inserted.rows[0]);
}

export async function updateBrandLeadStage(
  client: pg.PoolClient,
  input: { readonly leadId: string; readonly stage: unknown },
): Promise<BrandLeadSummary | null> {
  const selectedStage = stage(input.stage);
  const updated = await client.query(
    `UPDATE platform.crm_leads
        SET stage = $2, updated_at = now()
      WHERE lead_id = $1::uuid
      RETURNING lead_id, title, stage, amount_minor_units, currency, source,
                first_name, last_name, contact_name, contact_email, contact_phone,
                enquiry_interest_type, enquiry_opportunity_type,
                country_code, region_or_state, city,
                created_at, updated_at, NULL::text AS account_name`,
    [input.leadId, selectedStage],
  );
  return updated.rows[0] ? toSummary(updated.rows[0]) : null;
}

export async function convertBrandLeadToCustomer(
  client: pg.PoolClient,
  input: { readonly tenantId: string; readonly organizationId: string; readonly leadId: string },
): Promise<{ readonly leadId: string; readonly accountId: string } | null> {
  const leadResult = await client.query<{
    lead_id: string; organization_id: string; account_id: string | null; title: string; stage: BrandLeadStage;
  }>(
    `SELECT lead_id, organization_id, account_id, title, stage
       FROM platform.crm_leads
      WHERE lead_id = $1::uuid
      FOR UPDATE`,
    [input.leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) return null;
  if (lead.organization_id !== input.organizationId) throw new Error('LEAD_SCOPE_MISMATCH');
  if (lead.stage === 'LOST') throw new Error('LOST_LEAD_CANNOT_CONVERT');

  let accountId = lead.account_id;
  if (accountId) {
    const promoted = await client.query<{ account_id: string }>(
      `UPDATE platform.crm_accounts
          SET lifecycle_stage = 'CUSTOMER', updated_at = now()
        WHERE account_id = $1::uuid
          AND organization_id = $2::uuid
        RETURNING account_id`,
      [accountId, input.organizationId],
    );
    if (!promoted.rows[0]) throw new Error('ACCOUNT_SCOPE_MISMATCH');
  } else {
    const created = await client.query<{ account_id: string }>(
      `INSERT INTO platform.crm_accounts (tenant_id, organization_id, name, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, $3, 'CUSTOMER')
       RETURNING account_id`,
      [input.tenantId, input.organizationId, lead.title.slice(0, 200)],
    );
    accountId = created.rows[0]?.account_id ?? null;
  }
  if (!accountId) throw new Error('CUSTOMER_ACCOUNT_CREATION_FAILED');

  await client.query(
    `UPDATE platform.crm_leads
        SET account_id = $2::uuid, stage = 'WON', updated_at = now()
      WHERE lead_id = $1::uuid`,
    [input.leadId, accountId],
  );
  return { leadId: input.leadId, accountId };
}
