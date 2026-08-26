import React from 'react';
import styles from '../page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, EmptyState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';

export default async function OrganizationsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgs = await fetchApi<any[]>('/api/organizations/list');
  
  if (isDenied(orgs)) return <DeniedState result={orgs} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>CRM & Tenancy</p>
          <h1 id="page-title">Organizations</h1>
          <p>Manage organizational hierarchy and view membership distributions within this tenant.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="orgs-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="orgs-title">Active Organizations</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Organization Name</th>
                <th>Status</th>
                <th>Members</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.organization_id}>
                  <td><strong>{org.name}</strong><br /><span className={styles.code}>{org.organization_id}</span></td>
                  <td>
                    <StatePill state={org.status === 'ACTIVE' ? 'Published' : org.status === 'SUSPENDED' ? 'Review' : 'Draft'} />
                  </td>
                  <td>{org.members || 0}</td>
                  <td className={styles.muted}>{new Date(org.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgs.length === 0 && (
            <EmptyState title="No organizations" description="No child organizations exist in this tenant yet." />
          )}
        </div>
      </section>
    </>
  );
}
