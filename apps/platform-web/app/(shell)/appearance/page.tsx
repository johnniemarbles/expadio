import { isExpadioThemeDefinition } from '@expadio/ui';
import { listPlatformThemeProfiles } from '@expadio/postgres-runtime/theme-configuration';
import { PlatformAppearanceManager } from './PlatformAppearanceManager';
import { loadPlatformEffectiveTheme } from '@/lib/effective-theme';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import styles from './appearance.module.css';

export const dynamic='force-dynamic';

export default async function PlatformAppearancePage(){
  const context=await resolveRequestContext();
  const [effective,state]=await Promise.all([
    loadPlatformEffectiveTheme(),
    withTenantTransaction(context,async(client)=>({
      canPublish:await hasPlatformAdministrationRole(client,context.subjectId),
      history:await listPlatformThemeProfiles<unknown>(client,20),
    })),
  ]);
  const history=state.history.flatMap((item)=>{
    if(!isExpadioThemeDefinition(item.value))return [];
    return [{
      recordVersion:item.recordVersion,
      authoredAt:item.authoredAt,
      reason:item.reason,
      themeKey:item.value.key,
      themeName:item.value.name,
    }];
  });

  return <div className={styles.page}>
    <header className={styles.pageHead}><div><p>Design system governance</p><h1>Platform Appearance</h1><span>Publish the presentation profile inherited by Platform, Brands and compliant modules. Product structure and Industry Packs remain independent.</span></div></header>
    <PlatformAppearanceManager effectiveTheme={effective.theme} sourceLevel={effective.sourceLevel} canPublish={state.canPublish} history={history}/>
  </div>;
}
