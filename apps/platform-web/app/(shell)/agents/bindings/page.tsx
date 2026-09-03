import React from 'react';
import styles from '../../page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../../lib/request-context';

function bindingStatusClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'BOUND' || normalized === 'ACTIVE') return [styles.statusBadge, styles.statusSuccess].join(' ');
  if (normalized === 'SUSPENDED' || normalized === 'FAILED' || normalized === 'ERROR') return [styles.statusBadge, styles.statusDanger].join(' ');
  if (normalized === 'BINDING' || normalized === 'PENDING' || normalized === 'PROCESSING') return [styles.statusBadge, styles.statusLive].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

export default async function AgentBindingsPage({ searchParams: _searchParams }: { searchParams: RouteSearchParams }) {
  const bindings = await fetchApi<any[]>('/api/agents/bindings');
  
  if (isDenied(bindings)) return <DeniedState result={bindings} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Agent Intelligence</p>
          <h1 id="page-title">Agent Bindings</h1>
          <p>Map published capabilities (skills and workers) to governed agent identities.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="bindings-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="bindings-title">Active Capability Bindings</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Binding ID</th>
                <th>Capability Key</th>
                <th>Status</th>
                <th>Mapped Resource</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((binding) => (
                <tr key={binding.binding_id}>
                  <td><span className={styles.code}>{binding.binding_id}</span></td>
                  <td><strong>{binding.capability_key}</strong></td>
                  <td><span className={bindingStatusClass(String(binding.status ?? 'UNKNOWN'))}>{String(binding.status ?? 'UNKNOWN')}</span></td>
                  <td>{binding.mapped_to_resource || 'System'}</td>
                  <td className={styles.muted}>{new Date(binding.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bindings.length === 0 && (
            <EmptyState title="No agent bindings" description="No capabilities have been bound to an agent yet." />
          )}
        </div>
      </section>
    </>
  );
}
