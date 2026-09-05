'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../workspace.module.css';

type FunnelRow = {
  stage: string;
  total: number;
  verified: number;
  unverified: number;
  notRequired: number;
  uniqueContacts: number;
};

type TaskQueueRow = {
  priority: string;
  status: string;
  total: number;
  overdue: number;
  escalated: number;
};

type AttributionRow = {
  channel: string;
  surface: string;
  leadCount: number;
  verifiedCount: number;
};

type AnalyticsResponse = {
  funnel: FunnelRow[];
  taskQueue: TaskQueueRow[];
  attributionSources: AttributionRow[];
};

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

export default function LeadAnalyticsClient() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'funnel' | 'tasks' | 'attribution'>('funnel');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/leads/analytics', { cache: 'no-store' });
    const body = await readJson(r);
    if (body.funnel) setData(body as unknown as AnalyticsResponse);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>Loading analytics…</div>;
  if (!data) return <div className={styles.notice}>Analytics data unavailable.</div>;

  const totalLeads = data.funnel.reduce((s, r) => s + r.total, 0);
  const totalVerified = data.funnel.reduce((s, r) => s + r.verified, 0);
  const openTasks = data.taskQueue.filter((r) => r.status === 'OPEN').reduce((s, r) => s + r.total, 0);
  const escalatedTasks = data.taskQueue.reduce((s, r) => s + r.escalated, 0);

  return (
    <div>
      {/* KPI strip */}
      <div className={styles.grid} style={{ marginBottom: 20 }}>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Total leads</div>
          <div className={styles.metricValue}>{totalLeads}</div>
          <div className={styles.metricDetail}>Across all stages in subtree</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Verified</div>
          <div className={styles.metricValue}>{totalVerified}</div>
          <div className={styles.metricDetail}>OTP-verified public rail leads</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Open tasks</div>
          <div className={styles.metricValue}>{openTasks}</div>
          <div className={styles.metricDetail}>Pending across all priorities</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Escalated</div>
          <div className={styles.metricValue} style={{ color: escalatedTasks > 0 ? 'var(--theme-danger)' : undefined }}>{escalatedTasks}</div>
          <div className={styles.metricDetail}>Tasks past SLA escalation threshold</div>
        </article>
      </div>

      {/* Tabs */}
      <div className={styles.moduleTabs}>
        {(['funnel', 'tasks', 'attribution'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ all: 'unset', cursor: 'pointer', padding: '10px 12px', borderBottom: `2px solid ${tab === t ? 'var(--theme-primary)' : 'transparent'}`, color: tab === t ? 'var(--theme-primary)' : 'var(--theme-text-muted)', fontSize: 12, fontWeight: 700 }}
          >
            {t === 'funnel' ? 'Capture funnel' : t === 'tasks' ? 'Task queue' : 'Attribution'}
          </button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', all: 'unset', cursor: 'pointer', padding: '10px 12px', fontSize: 11, color: 'var(--theme-text-muted)' }}>
          Refresh
        </button>
      </div>

      {/* Capture funnel */}
      {tab === 'funnel' && (
        <div className={styles.panel}>
          <div className={styles.panelHead}><h2>Capture funnel by stage</h2></div>
          {data.funnel.length === 0
            ? <div className={styles.empty}>No funnel data available.</div>
            : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Total</th>
                      <th>Verified</th>
                      <th>Unverified</th>
                      <th>Not required</th>
                      <th>Unique contacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnel.map((r) => (
                      <tr key={r.stage}>
                        <td><span className={styles.pill}>{r.stage}</span></td>
                        <td><strong>{r.total}</strong></td>
                        <td style={{ color: 'var(--theme-success)' }}>{r.verified}</td>
                        <td style={{ color: r.unverified > 0 ? 'var(--theme-warning)' : undefined }}>{r.unverified}</td>
                        <td>{r.notRequired}</td>
                        <td>{r.uniqueContacts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* Task queue */}
      {tab === 'tasks' && (
        <div className={styles.panel}>
          <div className={styles.panelHead}><h2>Task queue by priority and status</h2></div>
          {data.taskQueue.length === 0
            ? <div className={styles.empty}>No task queue data available.</div>
            : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Priority</th><th>Status</th><th>Total</th><th>Overdue</th><th>Escalated</th></tr>
                  </thead>
                  <tbody>
                    {data.taskQueue.map((r, i) => (
                      <tr key={i}>
                        <td><span style={{ fontWeight: 800, color: r.priority === 'URGENT' ? 'var(--theme-danger)' : r.priority === 'HIGH' ? 'var(--theme-warning)' : undefined }}>{r.priority}</span></td>
                        <td><span className={styles.pill}>{r.status}</span></td>
                        <td>{r.total}</td>
                        <td style={{ color: r.overdue > 0 ? 'var(--theme-warning)' : undefined }}>{r.overdue}</td>
                        <td style={{ color: r.escalated > 0 ? 'var(--theme-danger)' : undefined }}>{r.escalated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* Attribution */}
      {tab === 'attribution' && (
        <div className={styles.panel}>
          <div className={styles.panelHead}><h2>Attribution by channel and surface</h2></div>
          {data.attributionSources.length === 0
            ? <div className={styles.empty}>No attribution data available.</div>
            : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Channel</th><th>Surface</th><th>Leads</th><th>Verified</th><th>Verification rate</th></tr>
                  </thead>
                  <tbody>
                    {data.attributionSources.map((r, i) => {
                      const rate = r.leadCount > 0 ? Math.round((r.verifiedCount / r.leadCount) * 100) : 0;
                      return (
                        <tr key={i}>
                          <td><span className={styles.pill}>{r.channel || '—'}</span></td>
                          <td>{r.surface || '—'}</td>
                          <td>{r.leadCount}</td>
                          <td style={{ color: 'var(--theme-success)' }}>{r.verifiedCount}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 60, height: 6, borderRadius: "var(--theme-radius-card)", background: 'var(--theme-surface-muted)', overflow: 'hidden' }}>
                                <div style={{ width: `${rate}%`, height: '100%', background: 'var(--theme-primary)' }} />
                              </div>
                              <span style={{ fontSize: 11 }}>{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}
