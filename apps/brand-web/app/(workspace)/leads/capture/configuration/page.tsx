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
          <p className={styles.eyebrow}>Growth · Lead Management</p>
          <h1>Capture Configuration</h1>
        </div>
      </section>
      <div className={styles.notice}>
        <strong>Lead Management is not active for this tenant.</strong>
        <p>Capture Configuration is part of the Lead Management module and follows the same tenant activation boundary.</p>
      </div>
    </>;
  }

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>Growth · {context.organizationName} · Lead Management</p>
        <h1>Capture Configuration</h1>
        <p>
          Each configuration activates a commercial interest type — Franchise, Distribution, Affiliate, License, or Agent — and associates it with the platform-governed schema, qualification profile, evidence profile, and workflow blueprint. All behavioral keys are resolved from the InterestTypeRegistry (ADR-017 Invariant 1) and cannot be replaced with free-form values.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads/publications">Publications</Link>
        <Link className={styles.secondaryButton} href="/leads/capture">Demand Capture</Link>
        <Link className={styles.secondaryButton} href="/leads/analytics">Analytics</Link>
      </div>
    </section>

    <CaptureConfigurationClient />
  </>;
}
