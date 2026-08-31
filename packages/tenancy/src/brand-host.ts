import { BRAND_HOST } from './hosts.ts';
import { ScopeMappingError } from './scope-adapter.ts';
import { BRAND_CUSTOMER_ROUTE, assertNotPlatformTenantLab, planBrandCustomerRead } from './brand-reads.ts';
import type { ShellScope, ShellScopeStorageKeys } from './shell-scope.ts';
import type { ScopeDirectory } from './scope-directory.ts';

type ActorKind = 'user' | 'party' | 'service' | 'agent';

type Identity = {
  readonly subjectId: string;
  readonly actorKind: ActorKind;
  readonly issuer?: string;
};

type Membership = {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceIds?: readonly string[];
  readonly operatingUnitIds?: readonly string[];
};

type BoundContext = {
  readonly subjectId: string;
  readonly actorKind: ActorKind;
  readonly issuer?: string;
  readonly tenantId: string;
  readonly organizationId: string;
};

export class BrandHostError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BrandHostError';
    this.status = status;
    this.code = code;
  }
}

export type BrandIncomingRequest = {
  readonly host: string;
  readonly path: string;
  readonly identity: Identity;
  readonly scope: ShellScope;
  readonly memberships: readonly Membership[];
};

export type BrandAuthorizedCustomerRead = {
  readonly host: typeof BRAND_HOST;
  readonly route: typeof BRAND_CUSTOMER_ROUTE;
  readonly storageKeys: ShellScopeStorageKeys;
  readonly context: BoundContext;
};

function requestHost(host: string): string {
  return host.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
}

function requestPath(path: string): string {
  const bare = path.split('?')[0];
  return bare.startsWith('/') ? bare : `/${bare}`;
}

function refusePlatformLab(target: string): void {
  try {
    assertNotPlatformTenantLab(target);
  } catch (error) {
    if (error instanceof ScopeMappingError) {
      throw new BrandHostError(403, error.code, error.message);
    }
    throw error;
  }
}

/**
 * Server-side Brand audience gate. Host + route + mapped keys + current membership.
 * CRM unit ownership is still unproven, so L-#### and SELECTED membership stay closed.
 */
export function authorizeBrandCustomerRequest(
  request: BrandIncomingRequest,
  directory: ScopeDirectory,
): BrandAuthorizedCustomerRead {
  if (request.scope.audience !== 'brand') {
    throw new BrandHostError(403, 'WRONG_AUDIENCE', 'Brand reads require the Brand audience.');
  }

  const host = requestHost(request.host);
  const path = requestPath(request.path);
  refusePlatformLab(`${host}${path}`);

  if (host !== BRAND_HOST) {
    throw new BrandHostError(403, 'BRAND_HOST_REQUIRED', 'Brand reads are served on app.expadio.com.');
  }
  if (path !== BRAND_CUSTOMER_ROUTE) {
    throw new BrandHostError(404, 'BRAND_ROUTE_NOT_FOUND', 'This Brand route is not connected.');
  }

  const plan = planBrandCustomerRead(request.scope, directory);
  if (plan.state !== 'keys-resolved') {
    throw new BrandHostError(403, plan.reason, 'Verified T/B/L mapping is required before Brand customer reads.');
  }
  if (plan.storageKeys.operatingUnitId !== null) {
    throw new BrandHostError(
      403,
      'LOCATION_SCOPE_UNAVAILABLE',
      'Location-specific customer access is not connected yet.',
    );
  }

  const membership = request.memberships.find(
    (candidate) =>
      candidate.tenantId === plan.storageKeys.tenantId &&
      candidate.organizationId === plan.storageKeys.organizationId,
  );
  if (!membership) {
    throw new BrandHostError(403, 'NO_MEMBERSHIP', 'You do not have access to this workspace.');
  }
  if (membership.workspaceIds !== undefined || membership.operatingUnitIds !== undefined) {
    throw new BrandHostError(
      403,
      'RESTRICTED_SCOPE_UNAVAILABLE',
      'Customer records are not yet available for location-restricted or workspace-restricted access.',
    );
  }

  const context: BoundContext = {
    subjectId: request.identity.subjectId,
    actorKind: request.identity.actorKind,
    tenantId: plan.storageKeys.tenantId,
    organizationId: plan.storageKeys.organizationId,
    ...(request.identity.issuer !== undefined ? { issuer: request.identity.issuer } : {}),
  };

  return {
    host: BRAND_HOST,
    route: BRAND_CUSTOMER_ROUTE,
    storageKeys: plan.storageKeys,
    context,
  };
}

/**
 * Serves the reserved Brand customer route after authorization.
 * The reader is injected. This is not a Next host and not a mutation.
 */
export async function serveBrandCustomerRead<T>(
  request: BrandIncomingRequest,
  directory: ScopeDirectory,
  read: (keys: ShellScopeStorageKeys, context: BoundContext) => Promise<T>,
): Promise<{
  readonly status: 200;
  readonly headers: { readonly 'Cache-Control': 'private, no-store' };
  readonly body: T;
  readonly served: true;
  readonly source: 'brand-audience';
}> {
  const authorized = authorizeBrandCustomerRequest(request, directory);
  const body = await read(authorized.storageKeys, authorized.context);
  return {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
    body,
    served: true,
    source: 'brand-audience',
  };
}
