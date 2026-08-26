import React from 'react';
import styles from '../../page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';

export default async function CredentialsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const credentials = await fetchApi<any[]>('/api/configuration/credentials');
  
  if (isDenied(credentials)) return <DeniedState result={credentials} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Admin</p>
          <h1 id="page-title">Credentials & Secrets</h1>
          <p>Manage, inject, and audit lifecycle rotations for provider credentials (OpenAI, AWS, DB).</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="creds-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="creds-title">Credential Rotation History</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Rotation ID</th>
                <th>Credential Name</th>
                <th>Status</th>
                <th>Rotated At</th>
                <th>Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((cred) => (
                <tr key={cred.rotation_id}>
                  <td><span className={styles.code}>{cred.rotation_id}</span></td>
                  <td><strong>{cred.credential_name}</strong></td>
                  <td>
                    <StatePill state={cred.status === 'SUCCESS' ? 'Published' : cred.status === 'FAILED' ? 'Draft' : 'Review'} />
                  </td>
                  <td className={styles.muted}>{new Date(cred.rotated_at).toLocaleString()}</td>
                  <td><span className={styles.code}>{cred.correlation_id}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {credentials.length === 0 && (
            <EmptyState title="No rotation history" description="No credential rotations have been audited yet." />
          )}
        </div>
      </section>
    </>
  );
}
