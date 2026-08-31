import { BRAND_HOST } from './hosts.ts';
import { ScopeMappingError } from './scope-adapter.ts';
import {
  BRAND_CUSTOMER_ROUTE,
  BRAND_FALLBACK_CUSTOMER_ROUTE,
  assertNotPlatformTenantLab,
  planBrandCustomerRead,
} from './brand-reads.ts';
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

export function requestHost(host: string): string {
  const stripped = host.replace(/^https?:\/\//i, '');
  const slash = stripped.indexOf('/');
  const namePort = slash === -1 ? stripped : stripped.slice(0, slash);
  const colon = namePort.indexOf(':');
  return (colon === -1 ? namePort : namePort.slice(0, colon)).toLowerCase();
}

export function requestPath(path: string): string {
  const query = path.indexOf('?');
  const bare = query === -1 ? path : path.slice(0, query);
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

/** Product host, or same-origin /brand/* fallback with Brand chrome. */
export function resolveBrandCustomerHttpTarget(host: string, path: string): {
  readonly host: typeof BRAND_HOST;
  readonly path: typeof BRAND_CUSTOMER_ROUTE;
  readonly via: 'brand-host' | 'same-origin-fallback';
} {
  const normalizedHost = requestHost(host);
  const normalizedPath = requestPath(path);
  refusePlatformLab(`${normalizedHost}${normalizedPath}`);
  if (normalizedPath === BRAND_FALLBACK_CUSTOMER_ROUTE) {
    return { host: BRAND_HOST, path: BRAND_CUSTOMER_ROUTE, via: 'same-origin-fallback' };
  }
  if (normalizedHost === BRAND_HOST && normalizedPath === BRAND_CUSTOMER_ROUTE) {
    return { host: BRAND_HOST, path: BRAND_CUSTOMER_ROUTE, via: 'brand-host' };
  }
  if (normalizedHost !== BRAND_HOST) {
    throw new BrandHostError(403, 'BRAND_HOST_REQUIRED', 'Brand reads are served on app.expadio.com.');
  }
  throw new BrandHostError(404, 'BRAND_ROUTE_NOT_FOUND', 'This Brand route is not connected.');
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

  const target = resolveBrandCustomerHttpTarget(request.host, request.path);
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
    host: target.host,
    route: target.path,
    storageKeys: plan.storageKeys,
    context,
  };
}

/**
 * Serves the reserved Brand customer route after authorization.
 * The reader is injected. Mutations are not enabled.
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
