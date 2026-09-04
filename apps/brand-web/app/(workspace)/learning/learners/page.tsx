import {
  listLearningEnrollments,
  listLearningLearners,
} from '@expadio/postgres-runtime/learning-enrollment';
import { listLearningCourses } from '@expadio/postgres-runtime/learning';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { LearnerAdminPanel } from '../../../../components/LearnerAdminPanel';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function LearnersPage() {
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') return { module, admin: false, learners: [], enrollments: [], courses: [] };
    const [admin, learners, enrollments, courses] = await Promise.all([
      hasLearningAdmin(client, context.subjectId),
      listLearningLearners(client, context.tenantId),
      listLearningEnrollments(client, { tenantId: context.tenantId }),
      listLearningCourses(client, context.tenantId),
    ]);
    return {
      module,
      admin,
      learners,
      enrollments,
      courses: courses
        .filter((course) => course.currentPublishedVersion !== null)
        .map((course) => ({
          courseId: course.courseId,
          title: course.publishedTitle ?? course.courseKey,
        })),
    };
  });

  return (
    <>
      <section className={styles.pageHead}>
        <div><p className={styles.eyebrow}>Learning · People</p><h1>Learners & enrollment</h1><p>Create or identity-link learners and assign immutable published course versions.</p></div>
      </section>
      {data.module?.availability !== 'ACTIVE' ? <div className={styles.notice}>Activate Learning before managing learners.</div> : (
        <>
          {data.admin ? <section className={styles.panel}><div className={styles.panelHead}><h2>Administration</h2></div><div className={styles.panelBody}><LearnerAdminPanel learners={data.learners.map((l) => ({ learnerId: l.learnerId, fullName: l.fullName, email: l.email ?? null }))} courses={data.courses} /></div></section> : null}
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Learners</h2><span>{data.learners.length}</span></div>
            {data.learners.length === 0 ? <div className={styles.empty}>No learners yet.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Name</th><th>Audience</th><th>Status</th><th>Identity</th><th>Email</th></tr></thead><tbody>{data.learners.map((learner) => <tr key={learner.learnerId}><td><strong>{learner.fullName}</strong></td><td>{learner.audienceType}</td><td><span className={styles.pill}>{learner.status}</span></td><td>{learner.subjectId ? 'Signed-in user' : learner.externalRef ?? '—'}</td><td>{learner.email ?? '—'}</td></tr>)}</tbody></table></div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Recent enrollments</h2><span>{data.enrollments.length}</span></div>
            {data.enrollments.length === 0 ? <div className={styles.empty}>No course assignments yet.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Learner</th><th>Course</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead><tbody>{data.enrollments.slice(0,100).map((entry) => <tr key={entry.enrollmentId}><td>{entry.learnerName}</td><td><strong>{entry.courseTitle}</strong><br />v{entry.courseVersion}</td><td><span className={styles.pill}>{entry.status}</span></td><td>{entry.completionPercent}%</td><td>{entry.dueAt ? new Date(entry.dueAt).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>}
          </section>
        </>
      )}
    </>
  );
}
