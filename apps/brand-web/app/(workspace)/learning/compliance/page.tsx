import Link from 'next/link';
import { loadLearningComplianceDashboard } from '@expadio/postgres-runtime/learning-compliance';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function LearningCompliancePage() {
  const context = await resolveBrandContext();
  const dashboard = await withBrandTransaction(context, async (client) => {
    if (!(await hasLearningAdmin(client, context.subjectId))) return null;
    return loadLearningComplianceDashboard(client, { tenantId: context.tenantId, limit: 100 });
  });

  if (dashboard === null) return <>
    <section className={styles.pageHead}><div><p className={styles.eyebrow}>Learning · Compliance</p><h1>Manager compliance</h1></div></section>
    <div className={styles.notice}><strong>Learning administration is required.</strong><p>Your current Brand membership cannot inspect tenant learning compliance.</p></div>
  </>;

  const metrics = [
    { label: 'Active learners', value: dashboard.metrics.activeLearners, detail: 'Eligible learner profiles' },
    { label: 'In learning', value: dashboard.metrics.activeEnrollments, detail: 'Assigned or in progress' },
    { label: 'Overdue', value: dashboard.metrics.overdueEnrollments, detail: 'Past due and incomplete' },
    { label: 'Completed', value: dashboard.metrics.completedEnrollments, detail: 'Completed course enrollments' },
    { label: 'Active programs', value: dashboard.metrics.activePrograms, detail: 'Assigned or in progress' },
    { label: 'Credentials at risk', value: dashboard.metrics.credentialsAtRisk, detail: 'Renewal or expiry within 30 days' },
  ];

  return <>
    <section className={styles.pageHead}>
      <div><p className={styles.eyebrow}>Learning · Compliance</p><h1>Manager compliance</h1><p>Prioritize overdue learning and credentials approaching renewal or expiry from canonical Learning records.</p></div>
      <Link className={styles.secondaryButton} href="/learning">Back to Learning</Link>
    </section>
    <section className={styles.grid}>{metrics.map((metric) => (
      <article key={metric.label} className={styles.metric}>
        <div className={styles.metricLabel}>{metric.label}</div>
        <div className={styles.metricValue}>{metric.value}</div>
        <div className={styles.metricDetail}>{metric.detail}</div>
      </article>
    ))}</section>
    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Needs attention</h2><span>{dashboard.attention.length}</span></div>
      {dashboard.attention.length === 0 ? <div className={styles.empty}>No active learners are overdue or within the 30-day credential risk window.</div> : (
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Learner</th><th>Overdue</th><th>Active courses</th><th>Active programs</th><th>Credentials at risk</th></tr></thead>
          <tbody>{dashboard.attention.map((learner) => (
            <tr key={learner.learnerId}>
              <td><strong>{learner.learnerName}</strong><br />{learner.email ?? 'No email'}</td>
              <td>{learner.overdueEnrollments}</td>
              <td>{learner.activeEnrollments}</td>
              <td>{learner.activePrograms}</td>
              <td>{learner.credentialsAtRisk}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className={styles.panelBody}><small>Generated {new Date(dashboard.generatedAt).toLocaleString()} · newest 100 learners requiring attention</small></div>
    </section>
  </>;
}
