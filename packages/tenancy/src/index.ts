export type ActorKind = 'user' | 'party' | 'service' | 'agent';
export { SHELL_NAVIGATION, shellViewSelection, unresolvedShellScope } from './shell-scope.ts';
export type { ShellAudience, ShellScope, ShellScopeStorageKeys, ScopeValue, TenantCode, BrandCode, LocationCode, LocationView, RoleHome } from './shell-scope.ts';
export { PLATFORM_HOST, BRAND_HOST, hostForAudience } from './hosts.ts';
export {
  ScopeMappingError,
  assertProductCode,
  parseTenantCode,
  parseBrandCode,
  parseLocationCode,
  mapShellScopeToStorageKeys,
  requireResolvedView,
  locationViewFromCode,
} from './scope-adapter.ts';
export { createScopeDirectory, createScopeDirectoryFromRows, bindingsFromPersistedRows } from './scope-directory.ts';
export type { ScopeDirectory, VerifiedScopeBinding, ScopeBindingRow } from './scope-directory.ts';
export { BRAND_APP, brandWorkspace } from './brand-shell.ts';
export type { BrandSurface, BrandSurfaceState } from './brand-shell.ts';
export {
  BRAND_CUSTOMER_ROUTE,
  BRAND_FALLBACK_CUSTOMER_ROUTE,
  PLATFORM_TENANT_LAB_ROUTE,
  planBrandCustomerRead,
  assertNotPlatformTenantLab,
} from './brand-reads.ts';
export type { BrandCustomerReadPlan } from './brand-reads.ts';
export {
  BrandHostError,
  authorizeBrandCustomerRequest,
  serveBrandCustomerRead,
  resolveBrandCustomerHttpTarget,
  requestHost,
  requestPath,
} from './brand-host.ts';
export type { BrandIncomingRequest, BrandAuthorizedCustomerRead } from './brand-host.ts';
export {
  PLATFORM_SAFE_ERROR_MESSAGE,
  platformSafeRef,
  classifyRequestPath,
  customerPiiPresent,
  redactCustomerPii,
  assertPlatformPayloadHasNoCustomerPii,
  assertPlatformLogHasNoCustomerPii,
  platformSafeErrorBody,
  assertBrandNavIsNotInsidePlatform,
} from './audience-boundary.ts';
export type { PlatformSafeRef, RequestSurface } from './audience-boundary.ts';
export {
  BRAND_JOURNEY_STEPS,
  JOURNEY_OBSERVATION_STATES,
  CS104_CORRELATION,
  BRAND_JOURNEY_ROUTE,
  BRAND_FALLBACK_JOURNEY_ROUTE,
  PLATFORM_JOURNEY_CORRELATION_ROUTE,
  emptyBrandJourneyObservation,
  assertJourneyIsObservationOnly,
  refuseBrandJourneyWrite,
  parseJourneyCorrelation,
  observeBrandJourneyFromFacts,
  platformViewOfJourney,
} from './brand-journey.ts';
export type {
  BrandJourneyStep,
  JourneyObservationState,
  FrozenExecutorClass,
  BrandJourneyStepObservation,
  BrandJourneyObservation,
  JourneyExecutorFact,
} from './brand-journey.ts';

export interface IdentityContext {
  readonly subjectId: string;
  readonly actorKind: ActorKind;
  readonly issuer?: string;
}

export interface MembershipContext {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceIds?: readonly string[];
  readonly operatingUnitIds?: readonly string[];
}

export interface ResolveEffectiveContextInput {
  readonly identity: IdentityContext;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly operatingUnitId?: string;
  readonly memberships: readonly MembershipContext[];
  readonly correlationId?: string;
}

export interface EffectiveContext {
  readonly subjectId: string;
  readonly actorKind: ActorKind;
  readonly issuer?: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly operatingUnitId?: string;
  readonly correlationId?: string;
}

export type ContextResolutionFailure =
  | 'NO_MEMBERSHIP'
  | 'WORKSPACE_OUT_OF_SCOPE'
  | 'OPERATING_UNIT_OUT_OF_SCOPE';

export class ContextResolutionError extends Error {
  readonly reason: ContextResolutionFailure;

  constructor(reason: ContextResolutionFailure) {
    super(reason);
    this.name = 'ContextResolutionError';
    this.reason = reason;
  }
}

export function resolveEffectiveContext(input: ResolveEffectiveContextInput): EffectiveContext {
  const membership = input.memberships.find(
    (candidate) =>
      candidate.tenantId === input.tenantId && candidate.organizationId === input.organizationId,
  );
  if (!membership) throw new ContextResolutionError('NO_MEMBERSHIP');

  if (
    input.workspaceId !== undefined &&
    membership.workspaceIds !== undefined &&
    !membership.workspaceIds.includes(input.workspaceId)
  ) {
    throw new ContextResolutionError('WORKSPACE_OUT_OF_SCOPE');
  }

  if (
    input.operatingUnitId !== undefined &&
    membership.operatingUnitIds !== undefined &&
    !membership.operatingUnitIds.includes(input.operatingUnitId)
  ) {
    throw new ContextResolutionError('OPERATING_UNIT_OUT_OF_SCOPE');
  }

  return {
    subjectId: input.identity.subjectId,
    actorKind: input.identity.actorKind,
    ...(input.identity.issuer !== undefined ? { issuer: input.identity.issuer } : {}),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.operatingUnitId !== undefined ? { operatingUnitId: input.operatingUnitId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
  };
}
