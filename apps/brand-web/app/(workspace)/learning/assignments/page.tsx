import Link from 'next/link';
import { listLearningAssignmentSubmissions } from '@expadio/postgres-runtime/learning-assignment';
import { listLearningAssignmentRuleExecutions } from '@expadio/postgres-runtime/learning-assignment-automation';
import { AssignmentGradingQueue } from '../../../../components/AssignmentGradingQueue';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function LearningAssignmentsPage() {
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client) => {
    if (!(await hasLearningAdmin(client, context.subjectId))) return null;
    const [submissions, executions] = await Promise.all([
      listLearningAssignmentSubmissions(client, context.tenantId),
      listLearningAssignmentRuleExecutions(client, { tenantId: context.tenantId, limit: 100 }),
    ]);
    return { submissions, executions };
  });

  if (data === null) return <>
    <section className={styles.pageHead}><div><p className={styles.eyebrow}>Learning · Assignments</p><h1>Grading workspace</h1></div></section>
    <div className={styles.notice}><strong>Learning administration is required.</strong><p>Your current Brand membership cannot review learner submissions.</p></div>
  </>;

  const { submissions, executions } = data;
  const awaiting = submissions.filter((item) => item.status === 'SUBMITTED' || item.status === 'RETURNED').length;
  const assigned = executions.filter((item) => item.outcome === 'ASSIGNED').length;
  const satisfied = executions.filter((item) => item.outcome === 'SATISFIED').length;
  const notMatched = executions.filter((item) => item.outcome === 'NOT_MATCHED').length;
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
    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Rule execution monitor</h2><span>{executions.length}</span></div>
      {executions.length === 0 ? <div className={styles.empty}>No assignment-rule executions have been recorded yet.</div> : (
        <>
          <div className={styles.panelBody}>
            <p><strong>{assigned}</strong> assigned · <strong>{satisfied}</strong> already satisfied · <strong>{notMatched}</strong> not matched</p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Rule</th><th>Learner</th><th>Outcome</th><th>Target</th><th>Evaluated</th><th>Correlation</th></tr></thead>
              <tbody>{executions.map((execution) => (
                <tr key={execution.assignmentRuleExecutionId}>
                  <td><strong>{execution.ruleName}</strong><br />{execution.ruleKey} · v{execution.ruleVersion}</td>
                  <td>{execution.learnerName}</td>
                  <td><span className={styles.pill}>{execution.outcome}</span></td>
                  <td>{execution.targetType}<br />{execution.enrollmentId ?? execution.programEnrollmentId ?? '—'}</td>
                  <td>{new Date(execution.evaluatedAt).toLocaleString()}</td>
                  <td><code>{execution.correlationId}</code>{execution.triggerEventId ? <><br /><small>event {execution.triggerEventId}</small></> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  </>;
}
