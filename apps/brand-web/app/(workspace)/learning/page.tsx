import Link from 'next/link';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { loadLearningDashboard } from '../../../lib/learning-data';
import styles from '../workspace.module.css';
import LearningClient from './LearningClient';

export const dynamic = 'force-dynamic';

export default async function LearningPage() {
  const context = await resolveBrandContext();
  const dashboard = await withBrandTransaction(context, (client) =>
    loadLearningDashboard(client, context.tenantId)
  );

  if (dashboard.module?.availability !== 'ACTIVE') {
    return (
      <>
        <section className={styles.pageHead}>
          <div>
            <p className={styles.eyebrow}>Learning</p>
            <h1>Learning workspace</h1>
            <p>Build courses, enroll learners, assess capability, issue credentials and use governed Learning AI.</p>
          </div>
        </section>
        <div className={styles.notice}>
          <strong>Learning is not active for this tenant.</strong>
          <p>Availability: {dashboard.module?.availability ?? 'UNAVAILABLE'}. Activation never creates an entitlement.</p>
          <Link className={styles.button} href="/learning/settings">
            Open Learning settings
          </Link>
        </div>
      </>
    );
  }

  return (
    <LearningClient
      dashboard={dashboard}
      academyName={dashboard.academyName ?? `${context.organizationName} Learning Academy`}
    />
  );
}
