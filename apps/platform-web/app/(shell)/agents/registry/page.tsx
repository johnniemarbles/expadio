import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import styles from '../page.module.css';

interface AgentEntry {
  assigned_agent_id: string;
  display_name?: string;
  department?: string;
  task_count: number;
  completed_count: number;
  failed_count: number;
  active_count: number;
  last_seen: string;
}

export default async function AgentRegistryPage() {
  const agents = await fetchApi<AgentEntry[]>('/api/agents/registry');
  if (isDenied(agents)) return <DeniedState result={agents} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Agent Intelligence</p>
          <h1 id="page-title">Agent Registry</h1>
          <p>Named agent identities observed executing tasks across this organisation.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="registry-title">
        <div className={styles.panelHeading}>
          <h2 id="registry-title">Known Agents ({agents.length})</h2>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent Identity</th>
                <th>Tasks</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Active Now</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.assigned_agent_id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.display_name || a.assigned_agent_id}</div>
                    <div className={styles.muted} style={{ fontSize: 11, marginTop: 2 }}>{a.department || 'System'} · <span className={styles.code}>{a.assigned_agent_id}</span></div>
                  </td>
                  <td>{a.task_count}</td>
                  <td>
                    <span className={[styles.statusBadge, a.completed_count > 0 ? styles.statusSuccess : styles.statusNeutral].join(' ')}>
                      {a.completed_count}
                    </span>
                  </td>
                  <td>
                    <span className={[styles.statusBadge, a.failed_count > 0 ? styles.statusDanger : styles.statusNeutral].join(' ')}>
                      {a.failed_count}
                    </span>
                  </td>
                  <td>
                    <span className={[styles.statusBadge, a.active_count > 0 ? styles.statusLive : styles.statusNeutral].join(' ')}>
                      {a.active_count > 0 ? `${a.active_count} running` : 'Idle'}
                    </span>
                  </td>
                  <td className={styles.muted}>{new Date(a.last_seen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {agents.length === 0 && (
            <EmptyState title="No agents observed" description="Agents will appear here once they execute tasks via the Chief of Staff orchestrator." />
          )}
        </div>
      </section>
    </>
  );
}
