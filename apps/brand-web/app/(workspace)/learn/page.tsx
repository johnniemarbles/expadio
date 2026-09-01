import Link from 'next/link';
import {
  listMyLearningEnrollments,
  loadMyLearningTranscript,
} from '@expadio/postgres-runtime/learning-enrollment';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function MyLearningPage() {
  const context = await resolveBrandContext();
  const value = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') return { module, home: null, transcript: [] };
    const [home, transcript] = await Promise.all([
      listMyLearningEnrollments(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
      loadMyLearningTranscript(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
    ]);
    return { module, home, transcript };
  });

  return (
    <>
      <section className={styles.pageHead}><div><p className={styles.eyebrow}>Learner</p><h1>My learning</h1><p>Your assigned courses, lesson progress and completed transcript.</p></div></section>
      {value.module?.availability !== 'ACTIVE' ? <div className={styles.notice}>Learning is not active for this tenant.</div>
        : value.home?.learner === null ? <div className={styles.notice}>Your signed-in identity is not linked to an active learner profile yet. Ask a Learning administrator to link your Clerk subject ID.</div>
          : <>
            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>Assigned learning</h2><span>{value.home?.enrollments.length ?? 0}</span></div>
              {value.home?.enrollments.length === 0 ? <div className={styles.empty}>No courses are assigned yet.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Lessons</th><th>Due</th></tr></thead><tbody>{value.home?.enrollments.map((entry) => <tr key={entry.enrollmentId}><td><Link href={`/learn/${entry.enrollmentId}`}><strong>{entry.courseTitle}</strong></Link><br />{entry.courseKey} · v{entry.courseVersion}</td><td><span className={styles.pill}>{entry.status}</span></td><td><div>{entry.completionPercent}%</div><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${entry.completionPercent}%` }} /></div></td><td>{entry.lessons.filter((lesson) => lesson.progressStatus === 'COMPLETED').length}/{entry.lessons.length}</td><td>{entry.dueAt ? new Date(entry.dueAt).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>Transcript</h2><span>{value.transcript.length}</span></div>
              {value.transcript.length === 0 ? <div className={styles.empty}>Completed courses will appear here.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Course</th><th>Version</th><th>Completed</th></tr></thead><tbody>{value.transcript.map((entry) => <tr key={entry.enrollmentId}><td>{entry.courseTitle}</td><td>{entry.courseVersion}</td><td>{new Date(entry.completedAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}
            </section>
          </>}
    </>
  );
}
