import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import type { EffectiveContext } from '@expadio/tenancy';
import { authorize } from '@expadio/authorization';
import { PostgresAuthorizationPolicyRepository } from '@expadio/postgres-runtime/authorization';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from './iam-adapter';

/** Live selection is untrusted until canonical membership verification succeeds. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function selectedScope(params: URLSearchParams, keys: string[], fallback: string | null): string {
  const explicit = keys.flatMap(key => params.getAll(key));
  const values = explicit.length ? explicit : [fallback];
  if (values.some(value => !value || !UUID.test(value)) || new Set(values.map(value => value?.toLowerCase())).size !== 1) {
    throw new ContextDenied('WORKSPACE_SCOPE_REQUIRED', 'Select a valid workspace.', 403);
  }
  return values[0]!.toLowerCase();
}

export interface ResolvedRequestContext {
  readonly effectiveContext?: EffectiveContext;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly organizationId: string | null;
  readonly platformScope: boolean;
  /** Set on the pooled client before any query, so RLS actually applies. */
  readonly applyTo: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<void>;
}

export class ContextDenied extends Error {
  readonly denied: DeniedResult;
  readonly status: number;

  constructor(reasonKey: string, message: string, status: number) {
    super(message);
    this.name = 'ContextDenied';
    this.denied = { denied: true, reasonKey, message };
    this.status = status;
  }
}

/**
 * Resolves the caller's real tenant. Never falls back to a demo tenant.
 *
 * Tenant selection comes from an explicit header the shell sets from the
 * active workspace; membership is then verified against the IAM spine, so a
 * forged header resolves to a denial rather than to another tenant's data.
 */
export async function resolveRequestContext(request?: Request): Promise<ResolvedRequestContext> {
  const { userId } = await auth();
  if (!userId) {
    throw new ContextDenied('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }

  const headerList = await headers();
  const params = request ? new URL(request.url).searchParams : new URLSearchParams();
  const requestedTenant = selectedScope(params, ['account'], headerList.get('x-expadio-tenant-id'));
  const requestedOrganization = selectedScope(params, ['org', 'organizationId'], headerList.get('x-expadio-organization-id'));

  let effective;
  try {
    effective = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: requestedTenant,
        organizationId: requestedOrganization,
      },
    );
  } catch {
    // A membership failure and a forged header are indistinguishable to the
    // caller by design: do not confirm that a tenant exists.
    throw new ContextDenied(
      'TENANT_ACCESS_DENIED',
      'You do not have access to this workspace.',
      403,
    );
  }

  const tenantId = effective.tenantId;
  const organizationId = effective.organizationId ?? null;

  const context: ResolvedRequestContext = {
    effectiveContext: effective,
    subjectId: effective.subjectId,
    tenantId,
    organizationId: organizationId ?? '',
    platformScope: false,
    applyTo: async (client) => {
      // RLS is enforced at the data layer, not in application code (§4.4).
      // Setting this is what makes platform.current_tenant_id() resolve.
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId ?? '']);
      await client.query('SELECT set_config($1, $2, true)', ['app.subject_id', effective.subjectId]);
    },
  };
  if (headerList.get('x-expadio-scope') !== 'PLATFORM') return context;
  // A requested platform view is not platform authority. Use persisted policy.
  return withTenantTransaction(context, async client => {
    const policy = await new PostgresAuthorizationPolicyRepository(client).loadPolicy(effective);
    const decision = authorize({ context: effective, ...policy, query: {
      action: 'platform.scope.use', intent: 'act',
      resource: { type: 'platform', id: 'platform', tenantId, organizationId: effective.organizationId },
    } });
    if (!decision.allowed) throw new ContextDenied('PLATFORM_ACCESS_DENIED', 'Platform scope is not authorized.', 403);
    return { ...context, platformScope: true };
  });
}

/** Runs `work` with a pooled client that already has the tenant GUC applied. */
export async function withTenantClient<T>(
  context: ResolvedRequestContext,
  work: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await dbPool.connect();
  try {
    await context.applyTo(client);
    return await work(client);
  } finally {
    client.release();
  }
}

/**
 * Runs one tenant-scoped work unit inside an explicit transaction.
 *
 * `context.applyTo` uses transaction-local PostgreSQL GUCs. Callers that need
 * RLS to remain bound across multiple statements must use this helper rather
 * than relying on an autocommit statement to retain a local setting.
 */
export async function withTenantTransaction<T>(
  context: ResolvedRequestContext,
  work: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await context.applyTo(client);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure. Driver/pool health handling belongs to
      // the runtime composition root rather than changing the denial surface.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** §3.4 — step-up authentication for credential intake, rotation, revocation. */
export async function requireStepUp(maxAgeSeconds = 300): Promise<void> {
  const headerList = await headers();
  const raw = headerList.get('x-expadio-reauth-at');
  if (raw === null) {
    throw new ContextDenied(
      'STEP_UP_REQUIRED',
      'Confirm your identity again to continue.',
      401,
    );
  }
  const age = (Date.now() - Date.parse(raw)) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > maxAgeSeconds) {
    throw new ContextDenied(
      'STEP_UP_EXPIRED',
      'Your confirmation has expired. Confirm your identity again to continue.',
      401,
    );
  }
}

export function deniedResponse(error: unknown): { body: DeniedResult; status: number } {
  if (error instanceof ContextDenied) {
    return { body: error.denied, status: error.status };
  }
  return {
    body: { denied: true, reasonKey: 'INTERNAL_ERROR', message: 'The request could not be completed.' },
    status: 500,
  };
}
export type RouteSearchParams = { [key: string]: string | string[] | undefined };
export async function requestedOrganizationId(searchParams?: RouteSearchParams | Promise<RouteSearchParams>): Promise<string> {
  const values = await searchParams ?? {};
  const params = new URLSearchParams();
  for (const key of ['org', 'organizationId']) {
    const value = values[key];
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  try {
    return selectedScope(params, ['org', 'organizationId'], (await headers()).get('x-expadio-organization-id'));
  } catch (error) {
    if (!(error instanceof ContextDenied)) throw error;
    // Let the protected API return its normal denied state; never fabricate an org.
    return '';
  }
}
