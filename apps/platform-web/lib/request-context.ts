import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from './iam-adapter';

/**
 * Design spec §0.2 G5 — un-scaffolding.
 *
 * Several early API routes used fixed demo tenant/organization identifiers.
 * That scaffolding has been removed from runtime context resolution. Tenant selection now arrives on
 * the `x-expadio-tenant-id` / `x-expadio-organization-id` request headers,
 * which `proxy.ts` injects from the shell's active workspace
 * (`?account=<tenantId>&org=<organizationId>`, with a cookie fallback).
 * Membership is verified below, so the header is a *request* for a tenant, not
 * proof of access.
 *
 * A cold request without a selected workspace resolves to the caller's first
 * active persisted membership. No demo tenant or request-time provisioning is
 * used.
 */

export interface ResolvedRequestContext {
  readonly subjectId: string;
  readonly issuer?: string | null;
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
  let tenantSelectionSource = headerList.get('x-expadio-tenant-source');
  let organizationSelectionSource = headerList.get('x-expadio-organization-source');
  if (request) {
    const url = new URL(request.url);
    if (url.searchParams.has('account')) {
      requestedTenant = url.searchParams.get('account');
      tenantSelectionSource = 'query';
    }
    if (url.searchParams.has('org')) {
      requestedOrganization = url.searchParams.get('org');
      organizationSelectionSource = 'query';
    }
  }
  const memberships = await membershipRepository.listActiveMemberships({
    subjectId: userId,
    issuer: 'https://clerk.expadio.com',
    actorKind: 'user',
  } as any);
  if (memberships.length === 0) {
    throw new ContextDenied(
      'NO_PLATFORM_MEMBERSHIP',
      'No active EXPADIO workspace membership is assigned to this user.',
      403,
    );
  }

  let selectedMembership;

  // Query-string selectors are an explicit authorization request and remain
  // fail-closed. Cookies are only persisted UI preferences: if hierarchy,
  // provisioning, or membership changes make one stale, recover to an
  // authorized membership instead of permanently bricking the shell.
  if (organizationSelectionSource === 'query' && requestedOrganization) {
    selectedMembership = memberships.find(
      (membership) =>
        membership.organizationId === requestedOrganization
        && (
          tenantSelectionSource !== 'query'
          || !requestedTenant
          || membership.tenantId === requestedTenant
        ),
    );
    if (!selectedMembership) {
      throw new ContextDenied(
        'TENANT_ACCESS_DENIED',
        'You do not have access to this workspace.',
        403,
      );
    }
  } else if (tenantSelectionSource === 'query' && requestedTenant) {
    const tenantMemberships = memberships.filter(
      (membership) => membership.tenantId === requestedTenant,
    );
    if (tenantMemberships.length === 0) {
      throw new ContextDenied(
        'TENANT_ACCESS_DENIED',
        'You do not have access to this workspace.',
        403,
      );
    }
    selectedMembership =
      (requestedOrganization
        ? tenantMemberships.find(
            (membership) => membership.organizationId === requestedOrganization,
          )
        : undefined)
      ?? tenantMemberships[0];
  } else {
    selectedMembership =
      (requestedOrganization
        ? memberships.find(
            (membership) =>
              membership.organizationId === requestedOrganization
              && (!requestedTenant || membership.tenantId === requestedTenant),
          )
        : undefined)
      ?? (requestedOrganization
        ? memberships.find(
            (membership) => membership.organizationId === requestedOrganization,
          )
        : undefined)
      ?? (requestedTenant
        ? memberships.find(
            (membership) => membership.tenantId === requestedTenant,
          )
        : undefined)
      ?? memberships[0];
  }

  requestedTenant = selectedMembership.tenantId;
  requestedOrganization = selectedMembership.organizationId;

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
    issuer: effective.issuer ?? null,
    tenantId,
    organizationId,
    platformScope: headerList.get('x-expadio-scope') === 'PLATFORM',
    applyTo: async (client) => {
      // RLS is enforced at the data layer, not in application code (§4.4).
      // Setting this is what makes platform.current_tenant_id() resolve.
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.subject_id', userId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.issuer', effective.issuer ?? '']);
      await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId ?? '']);
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

export async function requestedOrganizationId(
  _searchParams?: RouteSearchParams | Promise<RouteSearchParams>,
): Promise<string> {
  const context = await resolveRequestContext();
  if (!context.organizationId) {
    throw new ContextDenied(
      'ORGANIZATION_CONTEXT_REQUIRED',
      'Select an organization workspace to continue.',
      403,
    );
  }
  return context.organizationId;
}
