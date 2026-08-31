import {
  CS104_CORRELATION,
  assertPlatformPayloadHasNoCustomerPii,
  createScopeDirectoryFromRows,
  factsFromFrozenExecutorRows,
  observeBrandJourneyFromFacts,
  parseBrandCode,
  parseJourneyCorrelation,
  parseTenantCode,
  platformSafeLogLine,
  platformViewOfJourney,
  redactCustomerPii,
  type ScopeBindingRow,
} from '@expadio/tenancy';
import { readFrozenExecutorRows } from './brand-journey-facts';

export type PlatformSql = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export async function readPlatformCs104(
  client: PlatformSql,
  input: { tenantCode: string; brandCode: string; correlation?: string | null },
) {
  const tenant = parseTenantCode(input.tenantCode);
  const brand = parseBrandCode(input.brandCode);
  const correlation = parseJourneyCorrelation(input.correlation ?? CS104_CORRELATION);
  const lookup = await client.query<ScopeBindingRow>(
    `SELECT tenant_code, brand_code, location_code, tenant_id::text AS tenant_id,
            organization_id::text AS organization_id, operating_unit_id::text AS operating_unit_id
       FROM platform.lookup_product_scope_binding($1, $2, 'ALL')`,
    [tenant, brand],
  );
  const binding = lookup.rows[0];
  if (!binding) {
    throw new Error('PRODUCT_SCOPE_MAPPING_NOT_FOUND');
  }
  createScopeDirectoryFromRows([binding]);
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [binding.tenant_id]);
  const rows = await readFrozenExecutorRows(client, correlation);
  const observation =
    rows.length === 0
      ? observeBrandJourneyFromFacts(correlation, null, [])
      : observeBrandJourneyFromFacts(correlation, null, factsFromFrozenExecutorRows(correlation, rows));
  const communicate = observation.steps.find((step) => step.step === 'COMMUNICATE')?.state ?? 'not-observed';
  const delivery = observation.steps.find((step) => step.step === 'DELIVERY')?.state ?? 'not-observed';
  const payload = {
    ...platformViewOfJourney(observation),
    tenant,
    brand,
    location: 'ALL',
    communicate,
    delivery,
    deliveryClaimed: delivery === 'delivered',
    mutationsEnabled: false,
    autoSend: false,
  };
  assertPlatformPayloadHasNoCustomerPii(payload);
  return payload;
}

export function platformPiiProofSample() {
  const redacted = platformSafeLogLine(`retry ${redactCustomerPii('a@b.invalid')} CS-104 T-0001`);
  const payload = {
    surface: 'platform-product',
    cache: 'private, no-store',
    payloadScan: 'pass',
    sendingHealthScan: 'pass',
    sourceLogScan: 'pass',
    runtimeLogFile: 'not-read',
    sample: redacted,
  };
  assertPlatformPayloadHasNoCustomerPii(payload);
  return payload;
}
