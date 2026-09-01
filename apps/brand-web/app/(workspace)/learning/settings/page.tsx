import {
  loadLearningTenantContext,
  loadTenantProductModule,
} from '@expadio/postgres-runtime/product-module';
import { ActivateLearningButton } from '../../../../components/ActivateLearningButton';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, {
      tenantId: context.tenantId,
      moduleKey: 'learning',
    });
    const admin = await hasLearningAdmin(client, context.subjectId);
    const tenantContext =
      module?.availability === 'ACTIVE'
        ? await loadLearningTenantContext(client, context.tenantId)
        : null;
    return { module, admin, tenantContext };
  });

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Learning</p>
          <h1>Learning settings</h1>
          <p>Plan entitlement, activation and academy configuration for this tenant.</p>
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Module state</h2></div>
        <div className={styles.panelBody}>
          <p><strong>Availability:</strong> {data.module?.availability ?? 'UNAVAILABLE'}</p>
          <p><strong>Entitled:</strong> {data.module?.entitlement.active ? 'Yes' : 'No'}</p>
          <p><strong>Installation:</strong> {data.module?.installationState ?? 'Not installed'}</p>
          {data.tenantContext ? (
            <>
              <p><strong>Academy:</strong> {data.tenantContext.settings.academyName}</p>
              <p><strong>Language:</strong> {data.tenantContext.settings.defaultLanguage}</p>
              <p><strong>Timezone:</strong> {data.tenantContext.settings.defaultTimezone}</p>
              <p><strong>Learning AI:</strong> {data.tenantContext.settings.aiFeaturesEnabled ? 'Enabled' : 'Disabled'}</p>
            </>
          ) : null}
          {data.admin && data.module?.availability === 'READY_TO_ACTIVATE' ? <ActivateLearningButton /> : null}
          {data.module?.availability === 'LOCKED_BY_PLAN' ? (
            <div className={styles.notice}>
              Learning is not included in this tenant&apos;s active entitlement. Tenant users cannot self-grant plan access.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
