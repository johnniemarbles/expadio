export const TENANT_MODULE_STATES = [
  'ACTIVATION_PENDING',
  'PROVISIONING',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'PROVISIONING_FAILED',
] as const;

export type TenantModuleState = (typeof TENANT_MODULE_STATES)[number];

export const MODULE_ENTITLEMENT_SOURCES = [
  'PLAN',
  'ADD_ON',
  'TRIAL',
  'CONTRACT',
  'PLATFORM_GRANT',
] as const;

export type ModuleEntitlementSource = (typeof MODULE_ENTITLEMENT_SOURCES)[number];

export type TenantModuleAvailability =
  | 'UNAVAILABLE'
  | 'LOCKED_BY_PLAN'
  | 'READY_TO_ACTIVATE'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEACTIVATED'
  | 'FAILED';

export interface TenantModuleAvailabilityInput {
  readonly moduleEnabled: boolean;
  readonly entitlementActive: boolean;
  readonly installationState: TenantModuleState | null;
}

export function resolveTenantModuleAvailability(
  input: TenantModuleAvailabilityInput,
): TenantModuleAvailability {
  if (!input.moduleEnabled) return 'UNAVAILABLE';

  if (!input.entitlementActive) {
    if (
      input.installationState === 'ACTIVE'
      || input.installationState === 'PROVISIONING'
      || input.installationState === 'ACTIVATION_PENDING'
      || input.installationState === 'SUSPENDED'
    ) {
      return 'SUSPENDED';
    }
    return 'LOCKED_BY_PLAN';
  }

  switch (input.installationState) {
    case null:
      return 'READY_TO_ACTIVATE';
    case 'ACTIVATION_PENDING':
    case 'PROVISIONING':
      return 'PROVISIONING';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'SUSPENDED':
      return 'READY_TO_ACTIVATE';
    case 'DEACTIVATED':
      return 'DEACTIVATED';
    case 'PROVISIONING_FAILED':
      return 'FAILED';
  }
}

export function canActivateTenantModule(
  availability: TenantModuleAvailability,
): boolean {
  return availability === 'READY_TO_ACTIVATE'
    || availability === 'DEACTIVATED'
    || availability === 'FAILED';
}

export function isTenantModuleOperational(
  availability: TenantModuleAvailability,
): boolean {
  return availability === 'ACTIVE';
}

export function assertTenantModuleActivationAllowed(
  availability: TenantModuleAvailability,
): void {
  if (availability === 'ACTIVE' || availability === 'PROVISIONING') return;
  if (canActivateTenantModule(availability)) return;

  switch (availability) {
    case 'UNAVAILABLE':
      throw new Error('MODULE_UNAVAILABLE');
    case 'LOCKED_BY_PLAN':
    case 'SUSPENDED':
      throw new Error('MODULE_LOCKED_BY_PLAN');
    default:
      throw new Error('MODULE_ACTIVATION_NOT_ALLOWED');
  }
}
