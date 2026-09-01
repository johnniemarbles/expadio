import { listTenantProductModules } from '@expadio/postgres-runtime/product-module';
import { compileScopedThemeCss, parseProductModuleShellDescriptor } from '@expadio/ui';
import { BrandContextError, diagnoseBrandAccess, resolveBrandContext, withBrandTransaction } from '../../lib/brand-context';
import { BrandAccessRecovery } from '../../components/BrandAccessRecovery';
import { BrandShellFrame } from '../../components/BrandShellFrame';
import { loadBrandEffectiveTheme } from '../../lib/effective-theme';
import styles from './workspace.module.css';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  let context;
  try {
    context = await resolveBrandContext();
  } catch (error) {
    if (error instanceof BrandContextError && error.code === 'NO_BRAND_MEMBERSHIP') {
      const diagnostic = await diagnoseBrandAccess();
      return (
        <main className={styles.accessShell}>
          <section className={styles.accessCard}>
            <div className={styles.accessMark}>EXPADIO</div>
            <p className={styles.eyebrow}>Brand workspace access</p>
            <h1>Brand access unavailable</h1>
            <p>EXPADIO could not resolve an active Brand workspace for the Clerk identity currently signed into this browser.</p>
            {diagnostic ? <BrandAccessRecovery subjectId={diagnostic.subjectId} reason={diagnostic.reason} membershipStatus={diagnostic.status} validUntil={diagnostic.validUntil} /> : null}
          </section>
        </main>
      );
    }
    throw error;
  }

  const state = await withBrandTransaction(context, async (client) => ({
    modules: await listTenantProductModules(client, context.tenantId),
    theme: await loadBrandEffectiveTheme(client, context),
  }));
  const modules = state.modules;
  const descriptors = modules
    .filter((module) => module.availability === 'ACTIVE')
    .map((module) => parseProductModuleShellDescriptor({
      moduleKey: module.moduleKey,
      displayName: module.displayName,
      description: module.description,
      manifest: module.manifest,
    }))
    .filter((module): module is NonNullable<typeof module> => module !== null);

  const themeCss = compileScopedThemeCss(state.theme.theme, 'brand');
  return (
    <>
      <style data-expadio-effective-theme="brand" dangerouslySetInnerHTML={{__html:themeCss}} />
      <BrandShellFrame
      tenantName={context.tenantName}
      organizationName={context.organizationName}
      workspaces={context.workspaces}
      selectedWorkspace={context.tenantId+':'+context.organizationId}
      modules={descriptors}
      >
        {children}
      </BrandShellFrame>
    </>
  );
}
