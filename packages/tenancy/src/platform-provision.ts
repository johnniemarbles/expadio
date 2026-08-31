import { parseBrandCode, parseLocationCode, parseTenantCode, ScopeMappingError } from './scope-adapter.ts';
import { assertPlatformPayloadHasNoCustomerPii } from './audience-boundary.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;

export type PlatformProvisionInput = {
  readonly tenantCode: string;
  readonly brandCode: string;
  readonly locationCode: string;
  readonly tenantLabel?: string;
  readonly organizationLabel?: string;
  readonly locationLabel?: string;
  readonly createTenant?: boolean;
};

export type PlatformProvisionCommand = {
  readonly tenantCode: string;
  readonly brandCode: string;
  readonly locationCode: string;
  readonly tenantLabel: string;
  readonly organizationLabel: string;
  readonly locationLabel: string;
  readonly createTenant: boolean;
};

export type PlatformProvisionResult = {
  readonly tenant: string;
  readonly brand: string;
  readonly location: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly operatingUnitId: string | null;
  readonly brandHref: string;
};

function parseLabel(value: string | undefined, fallback: string): string {
  const label = (value ?? '').trim() || fallback;
  if (UUID.test(label) || !LABEL.test(label)) {
    throw new ScopeMappingError('INVALID_PROVISION_LABEL', 'Use a short operational label, not a UUID or address.');
  }
  return label;
}

export function parsePlatformProvisionInput(input: PlatformProvisionInput): PlatformProvisionCommand {
  if (UUID.test(input.tenantCode) || UUID.test(input.brandCode) || UUID.test(input.locationCode)) {
    throw new ScopeMappingError('STORAGE_KEY_IS_NOT_PRODUCT_CODE', 'Storage UUIDs are not T/B/L identifiers.');
  }
  const tenantCode = parseTenantCode(input.tenantCode);
  const brandCode = parseBrandCode(input.brandCode);
  const locationCode = input.locationCode === 'ALL' ? 'ALL' : parseLocationCode(input.locationCode);
  const command: PlatformProvisionCommand = {
    tenantCode,
    brandCode,
    locationCode,
    tenantLabel: parseLabel(input.tenantLabel, 'Tenant'),
    organizationLabel: parseLabel(input.organizationLabel, 'Brand workspace'),
    locationLabel: parseLabel(input.locationLabel, 'Primary location'),
    createTenant: Boolean(input.createTenant),
  };
  assertPlatformPayloadHasNoCustomerPii(command);
  return command;
}

export function platformProvisionResult(row: {
  readonly tenant_code: string;
  readonly brand_code: string;
  readonly location_code: string;
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly operating_unit_id: string | null;
}): PlatformProvisionResult {
  const location = row.location_code === 'ALL' ? 'ALL' : parseLocationCode(row.location_code);
  const result: PlatformProvisionResult = {
    tenant: parseTenantCode(row.tenant_code),
    brand: parseBrandCode(row.brand_code),
    location,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    operatingUnitId: row.operating_unit_id,
    brandHref: `/brand?tenant=${row.tenant_code}&brand=${row.brand_code}&location=${location}&view=customers`,
  };
  assertPlatformPayloadHasNoCustomerPii(result);
  return result;
}
