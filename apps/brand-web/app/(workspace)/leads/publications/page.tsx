import Link from 'next/link';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';
import PublicationsClient from './PublicationsClient';

export const dynamic = 'force-dynamic';

export default async function PublicationsPage() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) => loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  }));

  if (module?.availability !== 'ACTIVE') {
    return <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Growth · Lead Management</p>
          <h1>Publications</h1>
        </div>
      </section>
      <div className={styles.notice}>
        <strong>Lead Management is not active for this tenant.</strong>
        <p>Publications are part of the Lead Management module and follow the same tenant activation boundary.</p>
      </div>
    </>;
  }

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>Growth · {context.organizationName} · Lead Management</p>
        <h1>Publications</h1>
        <p>
          A publication ties one PUBLISHED Capture Configuration to one channel and is the attribution anchor for all submissions through that channel. Each publication owns its own Capture Source — never shared. Hosted-form publications are served at a brand-neutral URL (e.g. <code>apply.yourbrand.com/opportunity</code>).
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads/capture/configuration">Capture Configuration</Link>
        <Link className={styles.secondaryButton} href="/leads/capture">Demand Capture</Link>
        <Link className={styles.secondaryButton} href="/leads/analytics">Analytics</Link>
      </div>
    </section>

    <PublicationsClient />
  </>;
}
