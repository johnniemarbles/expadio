'use client';

import React, { useState, useEffect } from 'react';
import styles from './page.module.css';

interface Mission {
  mission_id: string;
  intent: string;
  status: string;
  summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface Task {
  task_id: string;
  mission_id: string;
  assigned_agent_id: string;
  title: string;
  description: string;
  requires_approval: boolean;
  status: string;
  error?: string | null;
  created_at: string;
}

interface ApprovalRequest {
  approval_id: string;
  mission_id: string;
  task_id: string;
  title: string;
  description: string;
  staged_changes: Record<string, unknown>;
  status: string;
  created_at: string;
}

interface ChiefOfStaffData {
  missions: Mission[];
  tasks: Task[];
  approvals: ApprovalRequest[];
}

function statusClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'COMPLETED' || normalized === 'APPROVED' || normalized === 'SUCCEEDED')
    return [styles.statusBadge, styles.statusSuccess].join(' ');
  if (normalized === 'FAILED' || normalized === 'REJECTED' || normalized === 'CANCELLED')
    return [styles.statusBadge, styles.statusDanger].join(' ');
  if (normalized === 'IN_PROGRESS' || normalized === 'RUNNING')
    return [styles.statusBadge, styles.statusLive].join(' ');
  if (normalized === 'AWAITING_APPROVAL' || normalized === 'PENDING' || normalized === 'QUEUED')
    return [styles.statusBadge, styles.statusPending].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

export function ChiefOfStaffClient({ initialData }: { initialData?: ChiefOfStaffData }) {
  const [data, setData] = useState<ChiefOfStaffData>(
    initialData ?? { missions: [], tasks: [], approvals: [] }
  );
  const [intent, setIntent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refreshData = async () => {
    try {
      const res = await fetch('/api/agent/missions');
      if (res.ok) {
        const json = await res.json();
        if (json.missions) {
          setData(json);
        }
      }
    } catch {
      // Ignore background refresh errors
    }
  };

  useEffect(() => {
    const timer = setInterval(refreshData, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleIntentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/agent/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: intent.trim() }),
      });

      const json = await res.json();
      if (res.ok) {
        setIntent('');
        setActionMessage(`Executive Mission initiated: ${json.missionId} (${json.status})`);
        await refreshData();
      } else {
        setActionMessage(`Error initiating mission: ${json.error ?? 'Unknown'}`);
      }
    } catch (err) {
      setActionMessage(`Network error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveApproval = async (missionId: string, approvalId: string, approved: boolean) => {
    if (resolvingApprovalId) return;
    setResolvingApprovalId(approvalId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/agent/missions/${missionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, approved }),
      });

      if (res.ok) {
        setActionMessage(`Approval ${approved ? 'approved' : 'rejected'} successfully.`);
        await refreshData();
      } else {
        const json = await res.json();
        setActionMessage(`Failed to resolve approval: ${json.error ?? 'Unknown'}`);
      }
    } catch (err) {
      setActionMessage(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setResolvingApprovalId(null);
    }
  };

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="chief-title">
        <div>
          <p className={styles.eyebrow}>Agent Executive Control Plane</p>
          <h1 id="chief-title">Chief of Staff Command & Missions</h1>
          <p>Direct autonomous agent squads, monitor executive missions, and govern human approvals.</p>
        </div>
      </section>

      {actionMessage && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'var(--theme-surface-muted)', border: '1px solid var(--theme-border)', marginBottom: '16px', fontSize: '14px' }}>
          {actionMessage}
        </div>
      )}

      <section className={styles.intentPanel} aria-labelledby="intent-heading">
        <h2 id="intent-heading" className={styles.intentHeading}>Dispatch Executive Intent</h2>
        <form onSubmit={handleIntentSubmit} className={styles.intentForm}>
          <input
            type="text"
            className={styles.intentInput}
            placeholder="e.g. Audit GTM Lead Routing SLA & verify Twilio webhook provider status"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={submitting}
          />
          <button type="submit" className={styles.intentBtn} disabled={submitting || !intent.trim()}>
            {submitting ? 'Initiating...' : 'Dispatch Mission'}
          </button>
        </form>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="missions-title">
          <div className={styles.panelHeading}>
            <h2 id="missions-title">Active Executive Missions ({data.missions.length})</h2>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mission ID</th>
                  <th>Intent</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.missions.map((mission) => (
                  <tr key={mission.mission_id}>
                    <td><span className={styles.code}>{mission.mission_id.slice(0, 8)}...</span></td>
                    <td style={{ fontWeight: 500 }}>{mission.intent}</td>
                    <td><span className={statusClass(mission.status)}>{mission.status}</span></td>
                    <td className={styles.muted}>{new Date(mission.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.missions.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '14px' }}>
                No active executive missions yet. Dispatch an intent above to start.
              </div>
            )}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="approvals-title">
          <div className={styles.panelHeading}>
            <h2 id="approvals-title">Governance Approvals ({data.approvals.filter(a => a.status === 'PENDING').length} Pending)</h2>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.approvals.map((app) => (
                  <tr key={app.approval_id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{app.title}</div>
                      <div className={styles.muted}>{app.description}</div>
                      <pre style={{ maxHeight: 180, overflow: 'auto', marginTop: 10, padding: 10, borderRadius: 6, background: 'var(--theme-surface-muted)', fontSize: 11, whiteSpace: 'pre-wrap' }} aria-label="Staged execution payload">
                        {JSON.stringify(app.staged_changes, null, 2)}
                      </pre>
                    </td>
                    <td><span className={statusClass(app.status)}>{app.status}</span></td>
                    <td>
                      {app.status === 'PENDING' ? (
                        <>
                          <button
                            type="button"
                            className={styles.approveBtn}
                            disabled={resolvingApprovalId !== null}
                            onClick={() => handleResolveApproval(app.mission_id, app.approval_id, true)}
                          >
                            {resolvingApprovalId === app.approval_id ? 'Saving...' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className={styles.rejectBtn}
                            disabled={resolvingApprovalId !== null}
                            onClick={() => handleResolveApproval(app.mission_id, app.approval_id, false)}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <span className={styles.muted}>Resolved</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.approvals.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '14px' }}>
                No governance approval requests pending.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="tasks-title">
        <div className={styles.panelHeading}>
          <h2 id="tasks-title">Agent Task Execution Log ({data.tasks.length})</h2>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Task Title</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((task) => (
                <tr key={task.task_id}>
                  <td><span className={styles.code}>{task.assigned_agent_id}</span></td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{task.title}</div>
                    {task.error && <div style={{ color: 'var(--theme-danger)', fontSize: '12px' }}>{task.error}</div>}
                  </td>
                  <td><span className={statusClass(task.status)}>{task.status}</span></td>
                  <td className={styles.muted}>{new Date(task.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.tasks.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '14px' }}>
              No agent task executions recorded.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
