import Link from 'next/link';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import styles from '../../../workspace.module.css';
import RoutingRulesClient from './RoutingRulesClient';

export const dynamic = 'force-dynamic';

export default async function DemandCaptureRoutingPage() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) => loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  }));

  if (module?.availability !== 'ACTIVE') {
    return <>
      <section className={styles.pageHead}><div><p className={styles.eyebrow}>Growth</p><h1>Demand Capture Routing</h1><p>Routing configuration follows the Lead Management activation boundary.</p></div></section>
      <div className={styles.notice}><strong>Lead Management is not active for this tenant.</strong><p>Routing cannot bypass module entitlement or activation.</p></div>
    </>;
  }

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>Growth · {context.organizationName}</p>
        <h1>Demand Capture Routing</h1>
        <p>Configure deterministic organization-scoped routes. Lower priority numbers are evaluated first; invalid or inactive targets are skipped and unresolved leads remain explicitly UNASSIGNED.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads/capture">Demand Capture</Link>
        <Link className={styles.secondaryButton} href="/leads">CRM leads</Link>
      </div>
    </section>
    <RoutingRulesClient />
  </>;
}
