import type pg from 'pg';

// ── CRM Accounts ──────────────────────────────────────────────────────────────

const VALID_LIFECYCLE_STAGES = new Set(['PROSPECT', 'LEAD', 'OPPORTUNITY', 'CUSTOMER', 'CHURNED']);

export interface CrmAccountSummary {
  readonly accountId: string;
  readonly name: string;
  readonly domain: string | null;
  readonly industry: string | null;
  readonly lifecycleStage: string;
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toAccountSummary(row: any): CrmAccountSummary {
  return {
    accountId: row.account_id,
    name: row.name,
    domain: row.domain ?? null,
    industry: row.industry ?? null,
    lifecycleStage: row.lifecycle_stage,
    countryCode: row.country_code ?? null,
    city: row.city ?? null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validateAccountInput(body: unknown) {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};

  const name = typeof record.name === 'string' ? record.name.trim().slice(0, 200) : '';
  if (name.length < 1) throw new Error('ACCOUNT_NAME_REQUIRED');

  const domain = typeof record.domain === 'string' && record.domain.trim()
    ? record.domain.trim().toLowerCase().slice(0, 200) : null;
  if (domain && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain)) {
    throw new Error('ACCOUNT_DOMAIN_INVALID');
  }

  const industry = typeof record.industry === 'string' && record.industry.trim()
    ? record.industry.trim().slice(0, 100) : null;

  const rawStage = typeof record.lifecycleStage === 'string' ? record.lifecycleStage.trim().toUpperCase() : 'PROSPECT';
  const lifecycleStage = VALID_LIFECYCLE_STAGES.has(rawStage) ? rawStage : 'PROSPECT';

  const rawCountry = typeof record.countryCode === 'string' ? record.countryCode.trim().toUpperCase() : null;
  const countryCode = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;

  const city = typeof record.city === 'string' && record.city.trim()
    ? record.city.trim().slice(0, 100) : null;

  return { name, domain, industry, lifecycleStage, countryCode, city };
}

export async function listCrmAccounts(
  client: pg.PoolClient,
  input: { readonly tenantId: string; readonly organizationId: string },
): Promise<readonly CrmAccountSummary[]> {
  const result = await client.query(
    `SELECT account_id, name, domain, industry, lifecycle_stage, country_code, city, status, created_at, updated_at
       FROM platform.crm_accounts
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 200`,
    [input.tenantId, input.organizationId],
  );
  return result.rows.map(toAccountSummary);
}

export async function searchCrmAccounts(
  client: pg.PoolClient,
  input: { readonly tenantId: string; readonly organizationId: string; readonly name: string; readonly domain: string },
): Promise<readonly CrmAccountSummary[]> {
  const conditions: string[] = ['a.tenant_id = $1::uuid', 'a.organization_id = $2::uuid', "a.status = 'ACTIVE'"];
  const values: unknown[] = [input.tenantId, input.organizationId];
  let idx = 3;

  const orConditions: string[] = [];
  if (input.name) {
    orConditions.push(`a.name ILIKE $${idx}`);
    values.push(`%${input.name}%`);
    idx++;
  }
  if (input.domain) {
    orConditions.push(`lower(a.domain) = $${idx}`);
    values.push(input.domain.toLowerCase());
    idx++;
  }
  if (orConditions.length === 0) return [];
  conditions.push(`(${orConditions.join(' OR ')})`);

  const result = await client.query(
    `SELECT account_id, name, domain, industry, lifecycle_stage, country_code, city, status, created_at, updated_at
       FROM platform.crm_accounts a
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT 5`,
    values,
  );
  return result.rows.map(toAccountSummary);
}

export async function createCrmAccount(
  client: pg.PoolClient,
  input: { readonly tenantId: string; readonly organizationId: string; readonly body: unknown },
): Promise<CrmAccountSummary> {
  const validated = validateAccountInput(input.body);
  const result = await client.query(
    `INSERT INTO platform.crm_accounts
       (tenant_id, organization_id, name, domain, industry, lifecycle_stage, country_code, city)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
     RETURNING account_id, name, domain, industry, lifecycle_stage, country_code, city, status, created_at, updated_at`,
    [
      input.tenantId, input.organizationId,
      validated.name, validated.domain, validated.industry, validated.lifecycleStage,
      validated.countryCode, validated.city,
    ],
  );
  return toAccountSummary(result.rows[0]);
}

// ── CRM Contacts ──────────────────────────────────────────────────────────────

export interface CrmContactSummary {
  readonly contactId: string;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly countryCode: string | null;
  readonly regionOrState: string | null;
  readonly city: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toContactSummary(row: any): CrmContactSummary {
  return {
    contactId: row.contact_id,
    accountId: row.account_id ?? null,
    accountName: row.account_name ?? null,
    fullName: row.full_name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    title: row.title ?? null,
    countryCode: row.country_code ?? null,
    regionOrState: row.region_or_state ?? null,
    city: row.city ?? null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validateContactInput(body: unknown) {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};

  const fullName = typeof record.fullName === 'string' ? record.fullName.trim().slice(0, 200) : '';
  if (fullName.length < 1) throw new Error('CONTACT_NAME_REQUIRED');

  const email = typeof record.email === 'string' && record.email.trim()
    ? record.email.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('CONTACT_EMAIL_INVALID');

  const phone = typeof record.phone === 'string' && record.phone.trim()
    ? record.phone.trim().slice(0, 50) : null;

  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim().slice(0, 100) : null;

  const accountId = typeof record.accountId === 'string' && /^[0-9a-f-]{36}$/i.test(record.accountId)
    ? record.accountId : null;

  const rawCountry = typeof record.countryCode === 'string' ? record.countryCode.trim().toUpperCase() : null;
  const countryCode = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;

  const regionOrState = typeof record.regionOrState === 'string' && record.regionOrState.trim()
    ? record.regionOrState.trim().slice(0, 100) : null;

  const city = typeof record.city === 'string' && record.city.trim()
    ? record.city.trim().slice(0, 100) : null;

  return { fullName, email, phone, title, accountId, countryCode, regionOrState, city };
}

export async function listCrmContacts(
  client: pg.PoolClient,
  input: { readonly tenantId: string },
): Promise<readonly CrmContactSummary[]> {
  const result = await client.query(
    `SELECT c.contact_id, c.account_id, c.full_name, c.email, c.phone, c.title,
            c.country_code, c.region_or_state, c.city, c.status, c.created_at, c.updated_at,
            a.name AS account_name
       FROM platform.crm_contacts c
       LEFT JOIN platform.crm_accounts a ON a.account_id = c.account_id
      WHERE c.tenant_id = $1::uuid
        AND c.status = 'ACTIVE'
      ORDER BY c.created_at DESC
      LIMIT 200`,
    [input.tenantId],
  );
  return result.rows.map(toContactSummary);
}

export async function searchCrmContacts(
  client: pg.PoolClient,
  input: { readonly tenantId: string; readonly email: string; readonly phone: string; readonly name: string },
): Promise<readonly CrmContactSummary[]> {
  const conditions: string[] = ["c.tenant_id = $1::uuid", "c.status = 'ACTIVE'"];
  const values: unknown[] = [input.tenantId];
  let idx = 2;

  const orConditions: string[] = [];
  if (input.email) {
    orConditions.push(`lower(c.email) = $${idx}`);
    values.push(input.email.toLowerCase());
    idx++;
  }
  if (input.phone) {
    orConditions.push(`regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace($${idx}, '[^0-9]', '', 'g')`);
    values.push(input.phone);
    idx++;
  }
  if (input.name && input.name.length >= 2) {
    orConditions.push(`c.full_name ILIKE $${idx}`);
    values.push(`%${input.name}%`);
    idx++;
  }
  if (orConditions.length === 0) return [];
  conditions.push(`(${orConditions.join(' OR ')})`);

  const result = await client.query(
    `SELECT c.contact_id, c.account_id, c.full_name, c.email, c.phone, c.title,
            c.country_code, c.region_or_state, c.city, c.status, c.created_at, c.updated_at,
            a.name AS account_name
       FROM platform.crm_contacts c
       LEFT JOIN platform.crm_accounts a ON a.account_id = c.account_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at DESC
      LIMIT 5`,
    values,
  );
  return result.rows.map(toContactSummary);
}

export async function createCrmContact(
  client: pg.PoolClient,
  input: { readonly tenantId: string; readonly body: unknown },
): Promise<CrmContactSummary> {
  const validated = validateContactInput(input.body);
  const result = await client.query(
    `INSERT INTO platform.crm_contacts
       (tenant_id, account_id, full_name, email, phone, title, country_code, region_or_state, city)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
     RETURNING contact_id, account_id, full_name, email, phone, title,
               country_code, region_or_state, city, status, created_at, updated_at,
               NULL::text AS account_name`,
    [
      input.tenantId,
      validated.accountId,
      validated.fullName, validated.email, validated.phone, validated.title,
      validated.countryCode, validated.regionOrState, validated.city,
    ],
  );
  return toContactSummary(result.rows[0]);
}
