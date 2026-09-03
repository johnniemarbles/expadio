import Link from 'next/link';
import { listLearningAssignmentSubmissions } from '@expadio/postgres-runtime/learning-assignment';
import { AssignmentGradingQueue } from '../../../../components/AssignmentGradingQueue';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function LearningAssignmentsPage() {
  const context = await resolveBrandContext();
  const submissions = await withBrandTransaction(context, async (client) => {
    if (!(await hasLearningAdmin(client, context.subjectId))) return null;
    return listLearningAssignmentSubmissions(client, context.tenantId);
  });

  if (submissions === null) return <>
    <section className={styles.pageHead}><div><p className={styles.eyebrow}>Learning · Assignments</p><h1>Grading workspace</h1></div></section>
    <div className={styles.notice}><strong>Learning administration is required.</strong><p>Your current Brand membership cannot review learner submissions.</p></div>
  </>;

  const awaiting = submissions.filter((item) => item.status === 'SUBMITTED' || item.status === 'RETURNED').length;
  return <>
    <section className={styles.pageHead}>
      <div><p className={styles.eyebrow}>Learning · Assignments</p><h1>Grading workspace</h1><p>Review real learner submissions, return actionable feedback, and record bounded final grades.</p></div>
      <Link className={styles.secondaryButton} href="/learning">Back to Learning</Link>
    </section>
    <section className={styles.grid}>
      <article className={styles.metric}><div className={styles.metricLabel}>Awaiting review</div><div className={styles.metricValue}>{awaiting}</div><div className={styles.metricDetail}>Submitted or returned work</div></article>
      <article className={styles.metric}><div className={styles.metricLabel}>Graded</div><div className={styles.metricValue}>{submissions.filter((item) => item.status === 'GRADED').length}</div><div className={styles.metricDetail}>Final grades recorded</div></article>
    </section>
    <section className={styles.panel}><div className={styles.panelHead}><h2>Submission queue</h2><span>{submissions.length}</span></div><div className={styles.panelBody}><AssignmentGradingQueue submissions={submissions} /></div></section>
  </>;
}
