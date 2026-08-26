import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';

export default async function ConfigurationManagerPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const config = await fetchApi<any>('/api/configuration');
  
  if (isDenied(config)) return <DeniedState result={config} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Operations</p>
          <h1 id="page-title">Business Configuration</h1>
          <p>Manage effective configuration across Platform, Vertical, and Tenant inheritance scopes.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="config-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="config-title">Active Settings</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Setting Key</th>
                <th>Value</th>
                <th>Resolved Scope</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {config.activeSettings.map((setting: any) => (
                <tr key={setting.key}>
                  <td><span className={styles.code}>{setting.key}</span></td>
                  <td><strong>{setting.value}</strong></td>
                  <td>{setting.scope}</td>
                  <td>
                    <StatePill state={setting.overridden ? 'Review' : 'Published'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
