import { listLearningCourses } from '@expadio/postgres-runtime/learning';
import { loadLearningAiSettings } from '@expadio/postgres-runtime/learning-ai';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { LearningAiPanel } from '../../../../components/LearningAiPanel';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function LearningAiPage() {
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') return { module, enabled: false, admin: false, courses: [] };
    const [settings, admin, courses] = await Promise.all([
      loadLearningAiSettings(client, context.tenantId),
      hasLearningAdmin(client, context.subjectId),
      listLearningCourses(client, context.tenantId),
    ]);
    return {
      module,
      enabled: settings.aiFeaturesEnabled,
      admin,
      courses: courses
        .filter((course) => course.currentPublishedVersion !== null)
        .map((course) => ({
          courseId: course.courseId,
          title: course.publishedTitle ?? course.draftTitle ?? course.courseKey,
        })),
    };
  });

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Learning · AI</p>
          <h1>AI tutor & author</h1>
          <p>Grounded learner assistance and governed draft generation through the Platform AI execution boundary.</p>
        </div>
      </section>
      {data.module?.availability !== 'ACTIVE' ? (
        <div className={styles.notice}>Activate Learning before using Learning AI.</div>
      ) : !data.enabled ? (
        <div className={styles.notice}>Learning AI is disabled for this tenant. A Learning administrator can enable it in Settings.</div>
      ) : (
        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Learning AI</h2><span className={styles.pill}>Governed execution</span></div>
          <div className={styles.panelBody}><LearningAiPanel admin={data.admin} courses={data.courses} /></div>
        </section>
      )}
    </>
  );
}
