import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from './iam-adapter';

/**
 * Design spec §0.2 G5 — un-scaffolding.
 *
 * Communications API routes used to hardcode tenant and organization
 * identifiers. That was scaffolding presenting as wiring. Tenant selection now
 * arrives on the `x-expadio-tenant-id` / `x-expadio-organization-id` request
 * headers, which `proxy.ts` injects from the shell's active workspace
 * (`?account=<tenantId>&org=<organizationId>`, with a cookie fallback).
 * Membership is verified below, so the header is a *request* for a tenant, not
 * proof of access.
 *
 * Cold requests with no selected workspace now fail closed instead of silently
 * resolving to a bootstrap workspace.
 */

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
 * Resolves the caller's real tenant. Never substitutes a scaffold tenant.
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
  let requestedTenant = headerList.get('x-expadio-tenant-id')?.trim() || null;
  let requestedOrganization = headerList.get('x-expadio-organization-id')?.trim() || null;
  if (request) {
    const url = new URL(request.url);
    if (url.searchParams.has('account')) requestedTenant = url.searchParams.get('account')?.trim() || null;
    if (url.searchParams.has('org')) requestedOrganization = url.searchParams.get('org')?.trim() || null;
  }

  if (requestedTenant === null) {
    throw new ContextDenied(
      'WORKSPACE_REQUIRED',
      'Select a workspace to continue.',
      400,
    );
  }

  const tenantIdRequest = requestedTenant;
  const organizationIdRequest = requestedOrganization ?? '';

  let effective;
  try {
    effective = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: tenantIdRequest,
        organizationId: organizationIdRequest,
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
    organizationId,
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

export type RouteSearchParams = { [key: string]: string | string[] | undefined };

type OrganizationSelectionSource = Request | RouteSearchParams | undefined;

function firstRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? '';
  return value?.trim() ?? '';
}

export function requestedOrganizationId(source?: OrganizationSelectionSource): string {
  if (source instanceof Request) {
    return new URL(source.url).searchParams.get('org')?.trim() ?? '';
  }
  return firstRouteParam(source?.org);
}
