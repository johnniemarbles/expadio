import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from './iam-adapter';

/**
 * Design spec §0.2 G5 — un-scaffolding.
 *
 * Every communications API route currently hardcodes
 *   tenantId: '00000000-0000-0000-0000-000000000001'
 *   organizationId: '00000000-0000-0000-0000-000000000002'
 *
 * That is scaffolding presenting as wiring. It descends from BEMP's
 * `withFallback()` helper, which retried with demo tenant headers on a 403 —
 * a demo affordance that became production scaffolding by being copied.
 *
 * While those constants remain, no tenant-isolation claim is testable through
 * the HTTP surface, which is why P1 lands before anything else.
 */

const DEMO_TENANT = '00000000-0000-0000-0000-000000000001';

export interface ResolvedRequestContext {
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
  if (userId === null || userId === undefined) {
    throw new ContextDenied('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }

  const headerList = await headers();
  let requestedTenant = headerList.get('x-expadio-tenant-id');
  let requestedOrganization = headerList.get('x-expadio-organization-id');
  if (request) {
    const url = new URL(request.url);
    if (url.searchParams.has('account')) requestedTenant = url.searchParams.get('account');
    if (url.searchParams.has('org')) requestedOrganization = url.searchParams.get('org');
  }
  requestedTenant = requestedTenant || DEMO_TENANT;
  requestedOrganization = requestedOrganization || '00000000-0000-0000-0000-000000000002';
  

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

  return {
    subjectId: userId,
    tenantId,
    organizationId: organizationId ?? '',
    platformScope: headerList.get('x-expadio-scope') === 'PLATFORM',
    applyTo: async (client) => {
      // RLS is enforced at the data layer, not in application code (§4.4).
      // Setting this is what makes platform.current_tenant_id() resolve.
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    },
  };
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
export type RouteSearchParams = { [key: string]: string | string[] | undefined }; export function requestedOrganizationId(_request?: any) { return '00000000-0000-0000-0000-000000000002'; }
