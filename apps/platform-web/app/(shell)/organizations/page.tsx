import React from 'react';
import styles from '../page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, EmptyState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import ProvisionScopeForm from './ProvisionScopeForm';

type OrgRow = {
  organization_id: string;
  name: string;
  status: string;
  members?: number;
  created_at?: string;
};

async function loadOrganizations(): Promise<{ rows: OrgRow[]; denied?: DeniedResult }> {
  try {
    const result = await fetchApi<OrgRow[]>('/api/organizations/list');
    if (isDenied(result)) return { rows: [], denied: result };
    if (Array.isArray(result)) return { rows: result };
    return { rows: [] };
  } catch {
    return {
      rows: [],
      denied: {
        denied: true,
        reasonKey: 'ORGANIZATION_LIST_UNAVAILABLE',
        message: 'This information could not be loaded. Please try again.',
      },
    };
  }
}

export default async function OrganizationsPage() {
  const { rows, denied } = await loadOrganizations();

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform</p>
          <h1 id="page-title">Tenants</h1>
          <p>Provision a Brand scope with operator-supplied T/B/L codes. UUIDs are storage keys, not product codes.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="provision-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="provision-title">Provision Brand scope</h2>
          </div>
        </div>
        <ProvisionScopeForm />
      </section>

      <section className={styles.panel} aria-labelledby="orgs-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="orgs-title">Organizations in this storage tenant</h2>
          </div>
        </div>
        {denied ? <DeniedState result={denied} /> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Status</th>
                <th>Members</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((org) => (
                <tr key={org.organization_id}>
                  <td><strong>{org.name}</strong><br /><span className={styles.code}>{org.organization_id}</span></td>
                  <td>
                    <StatePill state={org.status === 'ACTIVE' ? 'Published' : org.status === 'SUSPENDED' ? 'Review' : 'Draft'} />
                  </td>
                  <td>{org.members || 0}</td>
                  <td className={styles.muted}>{org.created_at ? new Date(org.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !denied ? (
            <EmptyState title="No organizations" description="Provision a Brand scope to create the first organization." />
          ) : null}
        </div>
      </section>
    </>
  );
}
