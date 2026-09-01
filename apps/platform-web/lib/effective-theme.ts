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
import { dbPool } from './iam-adapter';

export async function loadPlatformEffectiveTheme(){
  const client=await dbPool.connect();
  try{
    const validators=new Map([[THEME_CONFIGURATION_SETTING_KEY,governedThemeOverrideValidator]]);
    const service=createEffectiveThemeService({
      definitions:new PostgresConfigurationSettingDefinitionRepository(client,validators),
      values:new PostgresConfigurationValueCandidateRepository(client),
    });
    // Platform shell intentionally resolves only global Platform configuration.
    // Tenant and Brand values must never recolor the control plane.
    return await resolveGovernedTheme(service,{});
  }finally{
    client.release();
  }
}
