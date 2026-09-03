import Link from 'next/link';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';
import LeadImportClient from './LeadImportClient';

export const dynamic = 'force-dynamic';

export default async function LeadImportPage() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) =>
    loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' }),
  );

  if (module?.availability !== 'ACTIVE') {
    return (
      <>
        <section className={styles.pageHead}>
          <div><p className={styles.eyebrow}>Growth</p><h1>Lead Import</h1></div>
          <Link className={styles.secondaryButton} href="/leads/capture">Back to Demand Capture</Link>
        </section>
        <div className={styles.notice}><strong>Lead Management is not active for this tenant.</strong></div>
      </>
    );
  }

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Growth · {context.organizationName}</p>
          <h1>Lead Import</h1>
          <p>
            Bulk-import capture leads from CSV. Imports land as <strong>NOT_REQUIRED</strong> verification
            state — they bypass the PUBLIC-rail OTP gate and enter the pipeline directly.
            Requires an active capture source with the matching source key.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className={styles.secondaryButton} href="/leads/capture">Demand Capture</Link>
          <Link className={styles.secondaryButton} href="/leads/capture/routing">Routing rules</Link>
        </div>
      </section>
      <LeadImportClient />
    </>
  );
}
