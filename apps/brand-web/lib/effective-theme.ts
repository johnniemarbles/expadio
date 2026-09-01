import {
  createEffectiveThemeService,
  governedThemeOverrideValidator,
  resolveGovernedTheme,
  THEME_CONFIGURATION_SETTING_KEY,
} from '@expadio/ui';
import {
  PostgresConfigurationSettingDefinitionRepository,
  PostgresConfigurationValueCandidateRepository,
} from '@expadio/postgres-runtime/governed-configuration';
import type { PoolClient } from 'pg';
import type { BrandContext } from './brand-context';

export async function loadBrandEffectiveTheme(
  client:PoolClient,
  context:BrandContext,
){
  const tenant=await client.query<{vertical_key:string|null}>(
    'SELECT vertical_key FROM platform.tenants WHERE tenant_id=$1::uuid LIMIT 1',
    [context.tenantId],
  );
  const validators=new Map([[THEME_CONFIGURATION_SETTING_KEY,governedThemeOverrideValidator]]);
  const service=createEffectiveThemeService({
    definitions:new PostgresConfigurationSettingDefinitionRepository(client,validators),
    values:new PostgresConfigurationValueCandidateRepository(client),
  });
  return resolveGovernedTheme(service,{
    verticalKey:tenant.rows[0]?.vertical_key??undefined,
    tenantId:context.tenantId,
    brandId:context.organizationId,
  });
}
