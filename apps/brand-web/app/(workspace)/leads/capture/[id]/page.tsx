import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import styles from '../../../workspace.module.css';
import LeadDetailClient from './LeadDetailClient';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: captureLeadId } = await params;
  if (!UUID.test(captureLeadId)) notFound();

  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) =>
    loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' }),
  );

  if (module?.availability !== 'ACTIVE') {
    return (
      <>
        <section className={styles.pageHead}>
          <div><p className={styles.eyebrow}>Growth</p><h1>Lead Detail</h1></div>
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
          <p className={styles.eyebrow}>Growth · {context.organizationName} · Demand Capture</p>
          <h1>Lead detail</h1>
          <p>Activity timeline, tasks, and journey state for this capture lead.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className={styles.secondaryButton} href="/leads/capture">Back to inbox</Link>
          <Link className={styles.secondaryButton} href="/leads/analytics">Analytics</Link>
        </div>
      </section>
      <LeadDetailClient captureLeadId={captureLeadId} />
    </>
  );
}
