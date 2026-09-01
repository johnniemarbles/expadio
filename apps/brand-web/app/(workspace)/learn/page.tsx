import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { loadLearnerHome } from '../../../lib/learning-data';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function MyLearningPage() {
  const context = await resolveBrandContext();
  const value = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') return { module, home: null };
    const home = await loadLearnerHome(client, { tenantId: context.tenantId, subjectId: context.subjectId, issuer: context.issuer });
    return { module, home };
  });

  return (
    <>
      <section className={styles.pageHead}><div><p className={styles.eyebrow}>Learner</p><h1>My learning</h1><p>Your assigned courses, progress and completion state in this tenant.</p></div></section>
      {value.module?.availability !== 'ACTIVE' ? <div className={styles.notice}>Learning is not active for this tenant.</div>
        : value.home?.learner === null ? <div className={styles.notice}>Your signed-in identity is not linked to an active learner profile yet. Ask a Learning administrator to add or link you.</div>
          : <section className={styles.panel}><div className={styles.panelHead}><h2>{value.home?.learner?.name}</h2></div>{value.home?.enrollments.length === 0 ? <div className={styles.empty}>No courses are assigned yet.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead><tbody>{value.home?.enrollments.map((entry) => <tr key={String(entry.id)}><td><strong>{String(entry.course)}</strong><br />{String(entry.course_key)}</td><td><span className={styles.pill}>{String(entry.status)}</span></td><td><div>{Number(entry.progress)}%</div><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${Number(entry.progress)}%` }} /></div></td><td>{entry.due_at ? new Date(String(entry.due_at)).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>}</section>}
    </>
  );
}
