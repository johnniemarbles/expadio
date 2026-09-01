import { isThemeOverride, type ThemeOverride } from '@expadio/ui';
import { listTenantThemeOverrides } from '@expadio/postgres-runtime/theme-configuration';
import { BrandAppearanceManager } from './BrandAppearanceManager';
import { hasBrandAdministrationRole, resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { loadBrandEffectiveTheme } from '../../../lib/effective-theme';
import styles from './appearance.module.css';

export const dynamic='force-dynamic';

export default async function BrandAppearancePage(){
  const context=await resolveBrandContext();
  const state=await withBrandTransaction(context,async(client)=>{
    const [effective,history,canPublish]=await Promise.all([
      loadBrandEffectiveTheme(client,context),
      listTenantThemeOverrides<unknown>(client,context.tenantId,20),
      hasBrandAdministrationRole(client,context.subjectId),
    ]);
    return {effective,history,canPublish};
  });
  const validHistory=state.history
    .filter((item)=>isThemeOverride(item.value))
    .map((item)=>({
      recordVersion:item.recordVersion,
      authoredAt:item.authoredAt,
      reason:item.reason,
      value:item.value as ThemeOverride,
    }));
  const currentOverride=validHistory[0]?.value??{};

  return <div className={styles.page}>
    <header className={styles.pageHead}><div><p>Brand administration</p><h1>Appearance</h1><span>Apply approved Brand identity without changing Platform masters, module structure or another tenant.</span></div></header>
    <BrandAppearanceManager effectiveTheme={state.effective.theme} sourceLevel={state.effective.sourceLevel} canPublish={state.canPublish} currentOverride={currentOverride} history={validHistory}/>
  </div>;
}
