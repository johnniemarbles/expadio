import styles from '../../page.module.css';
import { dbPool } from '../../../../lib/iam-adapter';
import { MetricCard, WiringBanner } from '@expadio/ui';
import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function LearningModulePage() {
  const [coursesRes, learnersRes, enrollmentsRes] = await Promise.all([
    dbPool.query(`SELECT COUNT(*)::int AS count FROM platform.learning_courses WHERE status = 'ACTIVE'`),
    dbPool.query(`SELECT COUNT(*)::int AS count FROM platform.learning_learners WHERE status = 'ACTIVE'`),
    dbPool.query(`SELECT COUNT(*)::int AS count FROM platform.learning_enrollments`),
  ]);

  const activeCourses = coursesRes.rows[0]?.count || 0;
  const activeLearners = learnersRes.rows[0]?.count || 0;
  const totalEnrollments = enrollmentsRes.rows[0]?.count || 0;

  const metrics = [
    { label: 'Published Courses', value: String(activeCourses), detail: 'Active across all tenants', tone: activeCourses > 0 ? 'positive' : 'neutral' },
    { label: 'Active Learners', value: String(activeLearners), detail: 'Registered student profiles', tone: activeLearners > 0 ? 'positive' : 'neutral' },
    { label: 'Total Enrollments', value: String(totalEnrollments), detail: 'Course & program enrollments', tone: totalEnrollments > 0 ? 'positive' : 'neutral' },
  ] as const;

  const tenantStatsRes = await dbPool.query(`
    SELECT 
      t.tenant_id, 
      t.name,
      (SELECT COUNT(*) FROM platform.learning_courses c WHERE c.tenant_id = t.tenant_id AND c.status = 'ACTIVE') as courses,
      (SELECT COUNT(*) FROM platform.learning_learners l WHERE l.tenant_id = t.tenant_id AND l.status = 'ACTIVE') as learners
    FROM platform.tenants t
    WHERE EXISTS (
      SELECT 1 FROM platform.product_modules pm 
      WHERE pm.tenant_id = t.tenant_id AND pm.module_key = 'learning' AND pm.availability = 'ACTIVE'
    )
    ORDER BY learners DESC
    LIMIT 10
  `);

  const activeTenants = tenantStatsRes.rows;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Tenant Modules / Learning</p>
          <h1 id="page-title">Learning Module Analytics</h1>
          <p>Cross-tenant visibility into LMS usage, course publication, and learner volume.</p>
        </div>
        <div>
          <Link href="/modules" className={styles.secondaryButton}>← Back to Modules</Link>
        </div>
      </section>
      
      <WiringBanner source={{ kind: 'live', label: 'Live Database', capturedAt: new Date().toISOString() }} />
      
      <section className={styles.metricGrid} aria-label="Learning metrics">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>

      <section className={styles.panel} style={{ marginTop: '24px' }}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Tenant Adoption</p>
            <h2>Active Brands</h2>
          </div>
        </div>
        <div className={styles.panelBody}>
          {activeTenants.length === 0 ? (
            <p className={styles.empty}>No tenants have currently activated the Learning module.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tenant Name</th>
                    <th>Active Courses</th>
                    <th>Active Learners</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTenants.map((tenant: any) => (
                    <tr key={tenant.tenant_id}>
                      <td><strong>{tenant.name}</strong><br/><small style={{color: 'var(--color-text-dim)'}}>{tenant.tenant_id}</small></td>
                      <td>{tenant.courses}</td>
                      <td>{tenant.learners}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
