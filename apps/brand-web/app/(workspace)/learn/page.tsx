import Link from 'next/link';
import {
  listMyLearningEnrollments,
  loadMyLearningTranscript,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  listMyLearningCredentials,
  listMyLearningPrograms,
} from '@expadio/postgres-runtime/learning-program-certification';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function MyLearningPage() {
  const context = await resolveBrandContext();
  const value = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') {
      return { module, home: null, transcript: [], programs: [], credentials: [] };
    }

    const home = await listMyLearningEnrollments(client, {
      tenantId: context.tenantId,
      subjectId: context.subjectId,
      subjectIssuer: context.issuer,
    });
    if (home.learner === null) {
      return { module, home, transcript: [], programs: [], credentials: [] };
    }

    const [transcript, programs, credentials] = await Promise.all([
      loadMyLearningTranscript(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
      listMyLearningPrograms(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
      listMyLearningCredentials(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
    ]);
    return { module, home, transcript, programs, credentials };
  });

  const now = Date.now();
  const activeCourses = value.home?.enrollments.filter((entry) => entry.status === 'ASSIGNED' || entry.status === 'IN_PROGRESS') ?? [];
  const overdue = activeCourses.filter((entry) => entry.dueAt !== null && new Date(entry.dueAt).getTime() < now).length;
  const activePrograms = value.programs.filter((program) => program.status === 'ASSIGNED' || program.status === 'IN_PROGRESS').length;
  const activeCredentials = value.credentials.filter((credential) => credential.effectiveStatus === 'ACTIVE' || credential.effectiveStatus === 'EXPIRING').length;

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Learner</p>
          <h1>My learning</h1>
          <p>Continue required learning, track programs, review your transcript and access earned credentials.</p>
        </div>
      </section>
      {value.module?.availability !== 'ACTIVE' ? (
        <div className={styles.notice}>Learning is not active for this tenant.</div>
      ) : value.home?.learner === null ? (
        <div className={styles.notice}>Your signed-in identity is not linked to an active learner profile yet. Ask a Learning administrator to link your Clerk subject ID.</div>
      ) : (
        <>
          <section className={styles.grid}>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Active courses</div>
              <div className={styles.metricValue}>{activeCourses.length}</div>
              <div className={styles.metricDetail}>Assigned or in progress</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Overdue</div>
              <div className={styles.metricValue}>{overdue}</div>
              <div className={styles.metricDetail}>Past due and incomplete</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Active programs</div>
              <div className={styles.metricValue}>{activePrograms}</div>
              <div className={styles.metricDetail}>Structured learning journeys</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Credentials</div>
              <div className={styles.metricValue}>{activeCredentials}</div>
              <div className={styles.metricDetail}>Active or nearing renewal</div>
            </article>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Continue learning</h2><span>{value.home?.enrollments.length ?? 0}</span></div>
            {value.home?.enrollments.length === 0 ? (
              <div className={styles.empty}>No courses are assigned yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Lessons</th><th>Due</th></tr></thead>
                  <tbody>{value.home?.enrollments.map((entry) => (
                    <tr key={entry.enrollmentId}>
                      <td><Link href={`/learn/${entry.enrollmentId}`}><strong>{entry.courseTitle}</strong></Link><br />{entry.courseKey} · v{entry.courseVersion}</td>
                      <td><span className={styles.pill}>{entry.status}</span></td>
                      <td><div>{entry.completionPercent}%</div><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${entry.completionPercent}%` }} /></div></td>
                      <td>{entry.lessons.filter((lesson) => lesson.progressStatus === 'COMPLETED').length}/{entry.lessons.length}</td>
                      <td>{entry.dueAt ? new Date(entry.dueAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Programs</h2><span>{value.programs.length}</span></div>
            {value.programs.length === 0 ? (
              <div className={styles.empty}>No learning programs are assigned yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Program</th><th>Status</th><th>Progress</th><th>Assigned</th><th>Completed</th></tr></thead>
                  <tbody>{value.programs.map((program) => (
                    <tr key={program.programEnrollmentId}>
                      <td><strong>{program.programTitle}</strong><br />{program.programKey} · v{program.programVersion}</td>
                      <td><span className={styles.pill}>{program.status}</span></td>
                      <td><div>{program.completionPercent}%</div><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${program.completionPercent}%` }} /></div></td>
                      <td>{new Date(program.assignedAt).toLocaleDateString()}</td>
                      <td>{program.completedAt ? new Date(program.completedAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Credential wallet</h2><span>{value.credentials.length}</span></div>
            {value.credentials.length === 0 ? (
              <div className={styles.empty}>Credentials earned from completed programs will appear here.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Credential</th><th>Status</th><th>Issued</th><th>Renewal</th><th>Expires</th></tr></thead>
                  <tbody>{value.credentials.map((credential) => (
                    <tr key={credential.credentialId}>
                      <td><Link href={`/learn/credentials/${credential.credentialId}`}><strong>{credential.certificationTitle}</strong></Link><br />{credential.certificationKey}</td>
                      <td><span className={styles.pill}>{credential.effectiveStatus}</span></td>
                      <td>{new Date(credential.issuedAt).toLocaleDateString()}</td>
                      <td>{credential.renewalDueAt ? new Date(credential.renewalDueAt).toLocaleDateString() : '—'}</td>
                      <td>{credential.expiresAt ? new Date(credential.expiresAt).toLocaleDateString() : 'No expiry'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Transcript</h2><span>{value.transcript.length}</span></div>
            {value.transcript.length === 0 ? (
              <div className={styles.empty}>Completed courses will appear here.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Course</th><th>Version</th><th>Assigned</th><th>Completed</th></tr></thead>
                  <tbody>{value.transcript.map((entry) => (
                    <tr key={entry.enrollmentId}>
                      <td>{entry.courseTitle}</td>
                      <td>{entry.courseVersion}</td>
                      <td>{new Date(entry.assignedAt).toLocaleDateString()}</td>
                      <td>{new Date(entry.completedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
