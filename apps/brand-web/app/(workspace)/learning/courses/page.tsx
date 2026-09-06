import Link from 'next/link';
import { listLearningCourses } from '@expadio/postgres-runtime/learning';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';
import CoursesClient from './CoursesClient';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const context = await resolveBrandContext();
  const state = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    const courses = module?.availability === 'ACTIVE' ? await listLearningCourses(client, context.tenantId) : [];
    return { module, courses };
  });

  if (state.module?.availability !== 'ACTIVE') {
    return (
      <>
        <section className={styles.pageHead}>
          <div>
            <p className={styles.eyebrow}>Learning · Content</p>
            <h1>Courses</h1>
          </div>
        </section>
        <div className={styles.notice}>
          Learning is {state.module?.availability ?? 'unavailable'}. <Link href="/learning/settings">Open settings</Link>.
        </div>
      </>
    );
  }

  return (
    <CoursesClient
      initialCourses={state.courses}
      organizationName={context.organizationName}
    />
  );
}
