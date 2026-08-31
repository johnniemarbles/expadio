import type { Customer, CustomerCase, CustomerDecision, CustomerDetail, CustomerTask, PageResult, TenantContext, TenantIdentity, TenantScope } from './tenant-contracts.ts';

export type SqlClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};
export class TenantReadError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}
export function uuid(value: string | null): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new TenantReadError(400, 'INVALID_SCOPE_OR_ID', 'Choose a valid brand and organization, and use a valid record link.');
  }
  return value.toLowerCase();
}
export function parseTenantScope(url: URL): TenantScope {
  for (const key of ['account', 'org']) {
    if (url.searchParams.getAll(key).length !== 1) throw new TenantReadError(400, 'EXPLICIT_SCOPE_REQUIRED', 'Open this workspace with an explicit brand and organization.');
  }
  // CRM records have no operating-unit ownership yet. Do not silently broaden.
  if (['location', 'locationId', 'workspace', 'workspaceId'].some(key => url.searchParams.has(key))) {
    throw new TenantReadError(403, 'LOCATION_SCOPE_UNAVAILABLE', 'Location-specific customer access is not connected yet.');
  }
  return { tenantId: uuid(url.searchParams.get('account')), organizationId: uuid(url.searchParams.get('org')) };
}
export function parsePage(url: URL) {
  const limit = url.searchParams.get('limit') ?? '50';
  const offset = url.searchParams.get('offset') ?? '0';
  if (!/^\d+$/.test(limit) || !/^\d+$/.test(offset) || Number(limit) < 1 || Number(limit) > 100 || Number(offset) > 10000) {
    throw new TenantReadError(400, 'INVALID_PAGE', 'Use a page size from 1 to 100 and an offset from 0 to 10000.');
  }
  return { limit: Number(limit), offset: Number(offset) };
}
export function tenantErrorResponse(error: unknown): Response {
  const known = error instanceof TenantReadError;
  return Response.json({ denied: true, reasonKey: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'This information could not be loaded. Please try again.' },
  { status: known ? error.status : 500, headers: { 'Cache-Control': 'private, no-store' } });
}

/** No bootstrap membership, platform override, fixture fallback, or autocommit GUC. */
export async function withTenantRead<T>(
  pool: { connect(): Promise<SqlClient> }, identity: TenantIdentity,
  work: (client: SqlClient, context: TenantContext) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.organization_id', $2, true), set_config('app.subject_id', $3, true)",
      [identity.tenantId, identity.organizationId, identity.subjectId]);
    const result = await client.query<{ brand: string; organization: string; workspaceScope: string; locationScope: string }>(`
      SELECT t.name AS brand, o.name AS organization,
             m.workspace_scope_mode AS "workspaceScope", m.operating_unit_scope_mode AS "locationScope"
        FROM platform.memberships m
        JOIN platform.tenants t ON t.tenant_id = m.tenant_id AND t.status = 'ACTIVE'
        JOIN platform.organizations o ON o.tenant_id = m.tenant_id AND o.organization_id = m.organization_id AND o.status = 'ACTIVE'
       WHERE m.tenant_id = $1 AND m.organization_id = $2 AND m.subject_id = $3
         AND m.actor_kind = 'user' AND m.issuer = 'https://clerk.expadio.com'
         AND m.status = 'ACTIVE' AND m.valid_from <= CURRENT_TIMESTAMP
         AND (m.valid_until IS NULL OR m.valid_until > CURRENT_TIMESTAMP)`,
    [identity.tenantId, identity.organizationId, identity.subjectId]);
    if (result.rows.length !== 1) throw new TenantReadError(403, 'WORKSPACE_ACCESS_DENIED', 'You do not have access to this workspace.');
    const membership = result.rows[0];
    if (membership.workspaceScope !== 'ALL' || membership.locationScope !== 'ALL') {
      throw new TenantReadError(403, 'RESTRICTED_SCOPE_UNAVAILABLE', 'Customer records are not yet available for location-restricted or workspace-restricted access.');
    }
    const value = await work(client, { brand: membership.brand, organization: membership.organization, access: 'read-only' });
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally { client.release(); }
}

const customerColumns = `c.contact_id AS id, c.full_name AS name, c.email, c.phone, c.status,
  a.name AS "accountName", c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;
const customerJoin = `FROM platform.crm_contacts c
  JOIN platform.crm_accounts a ON a.account_id = c.account_id AND a.tenant_id = c.tenant_id
  WHERE c.tenant_id = $1 AND a.organization_id = $2 AND c.status <> 'ARCHIVED' AND a.status <> 'ARCHIVED'`;
function page<T>(rows: T[], limit: number): PageResult<T> { return { items: rows.slice(0, limit), hasMore: rows.length > limit }; }

export async function readCustomers(client: SqlClient, scope: TenantScope, pagination: { limit: number; offset: number }): Promise<PageResult<Customer>> {
  const result = await client.query<Customer>(`SELECT ${customerColumns} ${customerJoin}
    ORDER BY c.full_name, c.contact_id LIMIT $3 OFFSET $4`, [scope.tenantId, scope.organizationId, pagination.limit + 1, pagination.offset]);
  return page(result.rows, pagination.limit);
}

// Only crm.case is proven by crm-case-lifecycle-event.ts. No guessed aggregate types.
const taskQuery = `SELECT ot.task_id AS id, c.contact_id AS "customerId", c.full_name AS "customerName",
  ot.title, ot.status, ot.priority, ot.due_at AS "dueAt", ot.created_at AS "createdAt",
  COALESCE(ot.assignee_subject_id = $3, false) AS "isMine"
  FROM platform.operational_tasks ot
  JOIN platform.crm_cases k ON k.tenant_id = ot.tenant_id AND ot.aggregate_type = 'crm.case' AND ot.aggregate_id = k.case_id::text
  JOIN platform.crm_contacts c ON c.tenant_id = k.tenant_id AND c.contact_id = k.contact_id
  JOIN platform.crm_accounts a ON a.tenant_id = c.tenant_id AND a.account_id = c.account_id
  WHERE ot.tenant_id = $1 AND a.organization_id = $2 AND c.status <> 'ARCHIVED' AND a.status <> 'ARCHIVED'
    AND (k.account_id IS NULL OR k.account_id = c.account_id)`;

export async function readWork(client: SqlClient, identity: TenantIdentity, pagination: { limit: number; offset: number }): Promise<PageResult<CustomerTask>> {
  const result = await client.query<CustomerTask>(`${taskQuery} ORDER BY ot.created_at DESC, ot.task_id LIMIT $4 OFFSET $5`,
    [identity.tenantId, identity.organizationId, identity.subjectId, pagination.limit + 1, pagination.offset]);
  return page(result.rows, pagination.limit);
}

export async function readCustomer(client: SqlClient, identity: TenantIdentity, id: string): Promise<CustomerDetail> {
  const params = [identity.tenantId, identity.organizationId, id];
  const result = await client.query<Customer>(`SELECT ${customerColumns} ${customerJoin} AND c.contact_id = $3`, params);
  if (!result.rows[0]) throw new TenantReadError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found in this workspace.');
  // Scope every child read as well. Inconsistent cross-account case links fail closed.
  const caseJoin = `FROM platform.crm_cases k
    JOIN platform.crm_contacts c ON c.tenant_id = k.tenant_id AND c.contact_id = k.contact_id
    JOIN platform.crm_accounts a ON a.tenant_id = c.tenant_id AND a.account_id = c.account_id
    WHERE k.tenant_id = $1 AND a.organization_id = $2 AND c.contact_id = $3
      AND (k.account_id IS NULL OR k.account_id = c.account_id)`;
  const cases = await client.query<CustomerCase>(`SELECT k.case_id AS id, k.subject, k.status,
    k.created_at AS "createdAt", k.updated_at AS "updatedAt" ${caseJoin}
    ORDER BY k.created_at DESC, k.case_id LIMIT 101`, params);
  const decisions = await client.query<CustomerDecision>(`SELECT d.decision_id AS id, k.case_id AS "caseId",
    k.subject AS "caseSubject", d.outcome, d.decided_at AS "decidedAt"
    FROM platform.workflow_stage_decisions d
    JOIN platform.crm_cases k ON k.tenant_id = d.tenant_id AND k.workflow_instance_id = d.instance_id
    JOIN platform.workflow_instances w ON w.tenant_id = k.tenant_id AND w.instance_id = k.workflow_instance_id
      AND w.subject_type = 'crm.case' AND w.subject_id = k.case_id::text
    JOIN platform.crm_contacts c ON c.tenant_id = k.tenant_id AND c.contact_id = k.contact_id
    JOIN platform.crm_accounts a ON a.tenant_id = c.tenant_id AND a.account_id = c.account_id
    WHERE d.tenant_id = $1 AND a.organization_id = $2 AND c.contact_id = $3
      AND (k.account_id IS NULL OR k.account_id = c.account_id)
    ORDER BY d.decided_at DESC, d.decision_id, k.case_id LIMIT 101`, params);
  const tasks = await client.query<CustomerTask>(`${taskQuery} AND c.contact_id = $4
    ORDER BY ot.created_at DESC, ot.task_id LIMIT 101`, [identity.tenantId, identity.organizationId, identity.subjectId, id]);
  return { customer: result.rows[0], cases: cases.rows.slice(0, 100), decisions: decisions.rows.slice(0, 100), tasks: tasks.rows.slice(0, 100),
    truncated: { cases: cases.rows.length > 100, decisions: decisions.rows.length > 100, tasks: tasks.rows.length > 100 } };
}
