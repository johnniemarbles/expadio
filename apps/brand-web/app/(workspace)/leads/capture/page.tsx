import Link from 'next/link';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';
import DemandCaptureClient from './DemandCaptureClient';

export const dynamic = 'force-dynamic';

export default async function DemandCapturePage() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) => loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  }));

  if (module?.availability !== 'ACTIVE') {
    return <>
      <section className={styles.pageHead}><div><p className={styles.eyebrow}>Growth</p><h1>Demand Capture</h1><p>The 19-stage intake journey is part of Lead Management and follows the same tenant activation boundary.</p></div></section>
      <div className={styles.notice}><strong>Lead Management is not active for this tenant.</strong><p>Demand Capture cannot bypass module entitlement or activation.</p></div>
    </>;
  }

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>Growth · {context.organizationName}</p>
        <h1>Demand Capture</h1>
        <p>Operate the full 19-stage journey separately from the five-stage CRM projection. Journey stage, operational status, and ownership are independently governed and historically auditable.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads/capture/routing">Routing rules</Link>
        <Link className={styles.secondaryButton} href="/leads/analytics">Analytics</Link>
        <Link className={styles.secondaryButton} href="/leads">CRM leads</Link>
      </div>
    </section>
    <DemandCaptureClient />
  </>;
}
