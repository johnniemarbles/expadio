import {
  BrandHostError,
  CS104_CORRELATION,
  createScopeDirectoryFromRows,
  emptyBrandJourneyObservation,
  observeBrandJourneyFromFacts,
  parseBrandCode,
  parseJourneyCorrelation,
  parseLocationCode,
  parseTenantCode,
  platformViewOfJourney,
  refuseBrandJourneyWrite,
  serveBrandCustomerRead,
  unresolvedShellScope,
  type BrandIncomingRequest,
  type ScopeBindingRow,
  type ShellScope,
} from '@expadio/tenancy';
import { parsePage, readCustomers, TenantReadError, type SqlClient } from './tenant-read-model.ts';
import { readFrozenExecutorRows } from './brand-journey-facts.ts';

const PRODUCT_QUERY = ['tenant', 'brand', 'location'] as const;
const LAB_QUERY = ['account', 'org', 'locationId', 'workspace', 'workspaceId'] as const;

export type BrandSqlClient = SqlClient & {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export function brandErrorResponse(error: unknown): Response {
  if (error instanceof BrandHostError) {
    return Response.json(
      { denied: true, reasonKey: error.code, message: error.message },
      { status: error.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  if (error instanceof TenantReadError) {
    return Response.json(
      { denied: true, reasonKey: error.code, message: error.message },
      { status: error.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  if (error instanceof Error && error.message === 'BRAND_JOURNEY_MUTATION_FORBIDDEN') {
    return Response.json(
      { denied: true, reasonKey: 'BRAND_JOURNEY_MUTATION_FORBIDDEN', message: 'Brand journey observation is read-only.' },
      { status: 405, headers: { 'Cache-Control': 'private, no-store', Allow: 'GET' } },
    );
  }
  if (error instanceof Error && error.message === 'INVALID_JOURNEY_CORRELATION') {
    return Response.json(
      { denied: true, reasonKey: 'INVALID_JOURNEY_CORRELATION', message: 'Use a CS-#### correlation.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  if (error instanceof Error && error.message === 'JOURNEY_DELIVERY_NOT_INFERRED') {
    return Response.json(
      { denied: true, reasonKey: 'JOURNEY_DELIVERY_NOT_INFERRED', message: 'Scheduling or a task is not delivery.' },
      { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return Response.json(
    { denied: true, reasonKey: 'INTERNAL_ERROR', message: 'This information could not be loaded. Please try again.' },
    { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export function parseBrandProductScope(url: URL): ShellScope {
  for (const key of LAB_QUERY) {
    if (url.searchParams.has(key)) {
      throw new BrandHostError(
        400,
        'LAB_SCOPE_NOT_ACCEPTED',
        'Brand reads use tenant, brand and location product codes.',
      );
    }
  }
  for (const key of PRODUCT_QUERY) {
    if (url.searchParams.getAll(key).length !== 1) {
      throw new BrandHostError(
        400,
        'EXPLICIT_SCOPE_REQUIRED',
        'Open this workspace with tenant, brand and location.',
      );
    }
  }
  const tenant = url.searchParams.get('tenant') ?? '';
  const brand = url.searchParams.get('brand') ?? '';
  const location = url.searchParams.get('location') ?? '';
  try {
    return {
      ...unresolvedShellScope('brand'),
      tenant: { state: 'resolved', value: parseTenantCode(tenant) },
      brand: { state: 'resolved', value: parseBrandCode(brand) },
      location: {
        state: 'resolved',
        value: location === 'ALL' ? { kind: 'all-permitted' } : { kind: 'location', id: parseLocationCode(location) },
      },
    };
  } catch {
    throw new BrandHostError(
      400,
      'INVALID_PRODUCT_SCOPE_CODE',
      'Use T-####, B-#### and ALL or L-####.',
    );
  }
}

export function membershipsFromRows(
  rows: readonly {
    tenant_id: string;
    organization_id: string;
    workspace_scope_mode: string;
    operating_unit_scope_mode: string;
  }[],
): BrandIncomingRequest['memberships'] {
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    ...(row.workspace_scope_mode !== 'ALL' ? { workspaceIds: [] as const } : {}),
    ...(row.operating_unit_scope_mode !== 'ALL' ? { operatingUnitIds: [] as const } : {}),
  }));
}

export async function lookupScopeBinding(
  client: BrandSqlClient,
  scope: ShellScope,
): Promise<ScopeBindingRow | null> {
  if (scope.tenant.state !== 'resolved' || scope.brand.state !== 'resolved' || scope.location.state !== 'resolved') {
    return null;
  }
  const locationCode = scope.location.value.kind === 'all-permitted' ? 'ALL' : scope.location.value.id;
  const result = await client.query<ScopeBindingRow>(
    `SELECT tenant_code, brand_code, location_code, tenant_id::text AS tenant_id,
            organization_id::text AS organization_id, operating_unit_id::text AS operating_unit_id
       FROM platform.lookup_product_scope_binding($1, $2, $3)`,
    [scope.tenant.value, scope.brand.value, locationCode],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    tenant_code: row.tenant_code,
    brand_code: row.brand_code,
    location_code: row.location_code,
    tenant_id: row.tenant_id,
    organization_id: row.organization_id,
    operating_unit_id: row.operating_unit_id,
  };
}

async function bindBrandFallback(
  request: Request,
  subjectId: string | null,
  pool: { connect(): Promise<BrandSqlClient> },
): Promise<{
  client: BrandSqlClient;
  incoming: BrandIncomingRequest;
  directory: ReturnType<typeof createScopeDirectoryFromRows>;
}> {
  if (!subjectId) throw new BrandHostError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const url = new URL(request.url);
  const scope = parseBrandProductScope(url);
  const client = await pool.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const binding = await lookupScopeBinding(client, scope);
  const directory = createScopeDirectoryFromRows(binding ? [binding] : []);
  if (binding) {
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.organization_id', $2, true), set_config('app.subject_id', $3, true)",
      [binding.tenant_id, binding.organization_id, subjectId],
    );
  }
  const memberships = binding
    ? (
        await client.query<{
          tenant_id: string;
          organization_id: string;
          workspace_scope_mode: string;
          operating_unit_scope_mode: string;
        }>(
          `SELECT tenant_id::text AS tenant_id, organization_id::text AS organization_id,
                  workspace_scope_mode, operating_unit_scope_mode
             FROM platform.memberships
            WHERE subject_id = $1 AND actor_kind = 'user' AND issuer = 'https://clerk.expadio.com'
              AND status = 'ACTIVE' AND valid_from <= CURRENT_TIMESTAMP
              AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP)`,
          [subjectId],
        )
      ).rows
    : [];
  return {
    client,
    directory,
    incoming: {
      host: url.host,
      path: url.pathname,
      identity: { subjectId, actorKind: 'user', issuer: 'https://clerk.expadio.com' },
      scope,
      memberships: membershipsFromRows(memberships),
    },
  };
}

export async function serveBrandCustomerFallback(
  request: Request,
  subjectId: string | null,
  pool: { connect(): Promise<BrandSqlClient> },
): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePage(url);
  const bound = await bindBrandFallback(request, subjectId, pool);
  try {
    const response = await serveBrandCustomerRead(bound.incoming, bound.directory, (keys) =>
      readCustomers(bound.client, { tenantId: keys.tenantId, organizationId: keys.organizationId }, pagination),
    );
    await bound.client.query('COMMIT');
    return Response.json(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    try {
      await bound.client.query('ROLLBACK');
    } catch {
      /* preserve original error */
    }
    throw error;
  } finally {
    bound.client.release();
  }
}

export async function serveBrandJourneyFallback(
  request: Request,
  subjectId: string | null,
  pool: { connect(): Promise<BrandSqlClient> },
): Promise<Response> {
  refuseBrandJourneyWrite(request.method);
  const url = new URL(request.url);
  const correlation = parseJourneyCorrelation(url.searchParams.get('correlation') ?? CS104_CORRELATION);
  const bound = await bindBrandFallback(request, subjectId, pool);
  try {
    const incoming: BrandIncomingRequest = {
      ...bound.incoming,
      path: '/brand/api/customers',
    };
    await serveBrandCustomerRead(incoming, bound.directory, async () => null);
    const rows = await readFrozenExecutorRows(bound.client, correlation);
    const observation =
      rows.length === 0
        ? emptyBrandJourneyObservation(correlation, null)
        : observeBrandJourneyFromFacts(
            correlation,
            null,
            rows.map((row) => ({ correlation: row.correlation, executor: row.executor as 'SCHEDULE' | 'CREATE_TASK' | 'COMMUNICATE', state: 'queued' })).length >= 0
              ? (await import('@expadio/tenancy')).factsFromFrozenExecutorRows(correlation, rows)
              : [],
          );
    await bound.client.query('COMMIT');
    return Response.json(observation, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    try {
      await bound.client.query('ROLLBACK');
    } catch {
      /* preserve original error */
    }
    throw error;
  } finally {
    bound.client.release();
  }
}

export function platformJourneyCorrelationBody(correlation: string | null) {
  const observation = emptyBrandJourneyObservation(parseJourneyCorrelation(correlation), null);
  return platformViewOfJourney(observation);
}
