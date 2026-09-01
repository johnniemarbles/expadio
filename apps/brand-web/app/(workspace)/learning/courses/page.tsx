import Link from 'next/link';
import { listLearningCourses } from '@expadio/postgres-runtime/learning';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { CreateCourseForm } from '../../../../components/CreateCourseForm';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const context = await resolveBrandContext();
  const state = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    const courses = module?.availability === 'ACTIVE' ? await listLearningCourses(client, context.tenantId) : [];
    return { module, courses };
  });

  return (
    <>
      <section className={styles.pageHead}>
        <div><p className={styles.eyebrow}>Learning · Content</p><h1>Courses</h1><p>Create versioned learning content and publish immutable course versions to learners.</p></div>
      </section>
      {state.module?.availability !== 'ACTIVE' ? (
        <div className={styles.notice}>Learning is {state.module?.availability ?? 'unavailable'}. <Link href="/learning/settings">Open settings</Link>.</div>
      ) : (
        <>
          <section className={styles.panel}><div className={styles.panelHead}><h2>Create a course</h2></div><div className={styles.panelBody}><CreateCourseForm /></div></section>
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Course catalog</h2></div>
            {state.courses.length === 0 ? <div className={styles.empty}>No courses have been authored yet.</div> : (
              <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th>Course</th><th>Key</th><th>Status</th><th>Published</th><th>Draft</th></tr></thead>
                <tbody>{state.courses.map((course) => <tr key={course.courseId}>
                  <td><Link href={`/learning/courses/${course.courseId}`}><strong>{course.draftTitle ?? course.publishedTitle ?? course.courseKey}</strong></Link></td>
                  <td>{course.courseKey}</td><td><span className={styles.pill}>{course.status}</span></td>
                  <td>{course.currentPublishedVersion ?? '—'}</td><td>{course.draftVersion ?? '—'}</td>
                </tr>)}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </>
  );
}
