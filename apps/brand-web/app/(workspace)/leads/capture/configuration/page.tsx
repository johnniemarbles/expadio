import Link from 'next/link';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import styles from '../../../workspace.module.css';
import CaptureConfigurationClient from './CaptureConfigurationClient';

export const dynamic = 'force-dynamic';

export default async function CaptureConfigurationPage() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) => loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  }));

  if (module?.availability !== 'ACTIVE') {
    return <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Growth · {context.organizationName}</p>
          <h1>Enquiry setup</h1>
        </div>
      </section>
      <div className={styles.notice}>
        <strong>Lead Management is not active for this tenant.</strong>
      </div>
    </>;
  }

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>Growth · {context.organizationName}</p>
        <h1>Enquiry setup</h1>
        <p>Choose what enquiries your brand accepts. Forms are activated and ready to share in one step.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads">Leads</Link>
        <Link className={styles.secondaryButton} href="/leads/publications">Publications</Link>
        <Link className={styles.secondaryButton} href="/leads/capture">Demand Capture</Link>
      </div>
    </section>

    <CaptureConfigurationClient />
  </>;
}
