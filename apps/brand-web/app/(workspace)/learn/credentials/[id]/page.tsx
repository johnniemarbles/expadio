import { notFound } from 'next/navigation';
import { listMyLearningCredentials } from '@expadio/postgres-runtime/learning-program-certification';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import styles from '../../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function LearnerCredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await resolveBrandContext();
  const { id } = await params;
  const credential = await withBrandTransaction(context, async (client) => {
    const credentials = await listMyLearningCredentials(client, {
      tenantId: context.tenantId,
      subjectId: context.subjectId,
      subjectIssuer: context.issuer,
    });
    return credentials.find((entry) => entry.credentialId === id) ?? null;
  });
  if (!credential) notFound();

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Learner · Credential</p>
          <h1>{credential.certificationTitle}</h1>
          <p>{credential.certificationKey} · certification version {credential.certificationVersion}</p>
        </div>
        <span className={styles.pill}>{credential.effectiveStatus}</span>
      </section>

      <section className={styles.grid}>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Issued</div>
          <div className={styles.metricValue}>{new Date(credential.issuedAt).toLocaleDateString()}</div>
          <div className={styles.metricDetail}>Credential issue date</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Renewal due</div>
          <div className={styles.metricValue}>{credential.renewalDueAt ? new Date(credential.renewalDueAt).toLocaleDateString() : '—'}</div>
          <div className={styles.metricDetail}>Renewal window begins</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Expires</div>
          <div className={styles.metricValue}>{credential.expiresAt ? new Date(credential.expiresAt).toLocaleDateString() : 'Never'}</div>
          <div className={styles.metricDetail}>Current credential validity</div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Credential record</h2></div>
        <div className={styles.panelBody}>
          <p><strong>Credential key:</strong> {credential.credentialKey}</p>
          <p><strong>Status:</strong> {credential.status}</p>
          <p><strong>Effective status:</strong> {credential.effectiveStatus}</p>
          <p><strong>Program enrollment:</strong> {credential.programEnrollmentId}</p>
          <p><strong>Program version:</strong> {credential.programVersionId}</p>
          {credential.revokedAt ? <p><strong>Revoked:</strong> {new Date(credential.revokedAt).toLocaleString()}</p> : null}
          {credential.revocationReason ? <p><strong>Revocation reason:</strong> {credential.revocationReason}</p> : null}
        </div>
      </section>
    </>
  );
}
