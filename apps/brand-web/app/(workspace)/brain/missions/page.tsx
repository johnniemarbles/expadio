'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from '../../workspace.module.css';

interface Mission {
  mission_id: string;
  intent: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Task {
  task_id: string;
  mission_id: string;
  assigned_agent_id: string;
  title: string;
  status: string;
  error?: string | null;
  started_at: string | null;
  completed_at: string | null;
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

interface MissionsData {
  missions: Mission[];
  tasks: Task[];
  approvals: ApprovalRequest[];
}

function statusPill(status: string) {
  const s = status.toUpperCase();
  if (s === 'COMPLETED' || s === 'APPROVED') return { label: status, color: 'var(--theme-success)' };
  if (s === 'FAILED' || s === 'REJECTED') return { label: status, color: 'var(--theme-danger)' };
  if (s === 'IN_PROGRESS' || s === 'RUNNING') return { label: status, color: 'var(--theme-primary)' };
  if (s === 'AWAITING_APPROVAL' || s === 'PENDING') return { label: status, color: 'var(--theme-warning)' };
  return { label: status, color: 'var(--theme-text-muted)' };
}

function StatusChip({ status }: { status: string }) {
  const { label, color } = statusPill(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
      borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: '.04em',
      color, background: `color-mix(in srgb,${color} 12%,transparent)`,
      border: `1px solid color-mix(in srgb,${color} 30%,var(--theme-border))`,
    }}>
      {label}
    </span>
  );
}

export default function BrandMissionsPage() {
  const [data, setData] = useState<MissionsData>({ missions: [], tasks: [], approvals: [] });
  const [intent, setIntent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/missions');
      if (res.ok) {
        const json = await res.json();
        if (json.missions) setData(json);
      }
    } catch {
      // background refresh — ignore errors
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const dispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/brain/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: intent.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setIntent('');
        setNotice(`Mission dispatched — ${json.missionId}`);
        await refresh();
      } else {
        setNotice(`Error: ${json.error ?? 'Unknown'}`);
      }
    } catch (err) {
      setNotice(`Network error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const resolveApproval = async (missionId: string, approvalId: string, approved: boolean) => {
    if (resolvingApprovalId) return;
    setResolvingApprovalId(approvalId);
    setNotice(null);
    try {
      const res = await fetch(`/api/brain/missions/${missionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, approved }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(`Unable to resolve approval: ${body.error ?? 'Unknown error'}.`);
        return;
      }
      setNotice(`Approval ${approved ? 'approved' : 'rejected'}; mission is now ${body.status}.`);
      await refresh();
    } catch (err) {
      setNotice(`Unable to resolve approval: ${err instanceof Error ? err.message : 'Network error'}.`);
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const missionTasks = selectedMission
    ? data.tasks.filter((t) => t.mission_id === selectedMission)
    : [];
  const pendingApprovals = data.approvals.filter((a) => a.status === 'PENDING');

  return (
    <div className={styles.moduleViewport}>
      <div className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Brand Brain · Agent Missions</p>
          <h1>Executive Missions</h1>
          <p>Dispatch governed intelligence requests and track autonomous task execution for your brand workspace.</p>
        </div>
      </div>

      {notice && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 18, fontSize: 13,
          background: 'var(--theme-surface-muted)', border: '1px solid var(--theme-border)',
        }}>
          {notice}
        </div>
      )}

      <form onSubmit={dispatch} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          disabled={submitting}
          placeholder="e.g. Review brand comms SLA and flag overdue campaigns"
          style={{
            flex: 1, padding: '11px 14px', borderRadius: 9, fontSize: 13,
            border: '1px solid var(--theme-border)', background: 'var(--theme-surface-muted)',
            color: 'var(--theme-text-primary)', outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={submitting || !intent.trim()}
          className={styles.button}
          style={{ minWidth: 140, fontSize: 13 }}
        >
          {submitting ? 'Dispatching…' : 'Dispatch Mission'}
        </button>
      </form>

      {pendingApprovals.length > 0 && (
        <div className={styles.panel} style={{ marginBottom: 18 }}>
          <div className={styles.panelHead}>
            <h2>Pending Approvals ({pendingApprovals.length})</h2>
          </div>
          <div className={styles.panelBody}>
            {pendingApprovals.map((a) => (
              <div key={a.approval_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '12px 0', borderBottom: '1px solid var(--theme-border)',
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 3 }}>
                    {a.description}
                  </div>
                  <pre style={{ maxHeight: 160, overflow: 'auto', marginTop: 8, padding: 8, borderRadius: 6, background: 'var(--theme-surface-muted)', fontSize: 11, whiteSpace: 'pre-wrap' }} aria-label="Staged execution payload">
                    {JSON.stringify(a.staged_changes, null, 2)}
                  </pre>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    className={styles.button}
                    style={{ fontSize: 12, padding: '7px 12px', background: 'var(--theme-success)' }}
                    disabled={resolvingApprovalId !== null}
                    onClick={() => resolveApproval(a.mission_id, a.approval_id, true)}
                  >
                    {resolvingApprovalId === a.approval_id ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    style={{ fontSize: 12, padding: '7px 12px', color: 'var(--theme-danger)', borderColor: 'var(--theme-danger)' }}
                    disabled={resolvingApprovalId !== null}
                    onClick={() => resolveApproval(a.mission_id, a.approval_id, false)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedMission ? '1fr 1fr' : '1fr', gap: 18 }}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Missions ({data.missions.length})</h2>
            {selectedMission && (
              <button
                className={styles.secondaryButton}
                style={{ fontSize: 11, padding: '5px 10px' }}
                onClick={() => setSelectedMission(null)}
              >
                Clear
              </button>
            )}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Intent</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.missions.map((m) => (
                  <tr
                    key={m.mission_id}
                    style={{
                      cursor: 'pointer',
                      background: selectedMission === m.mission_id ? 'var(--theme-navigation-active)' : undefined,
                    }}
                    onClick={() => setSelectedMission(m.mission_id === selectedMission ? null : m.mission_id)}
                  >
                    <td style={{ fontWeight: 600 }}>{m.intent}</td>
                    <td><StatusChip status={m.status} /></td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: 11 }}>
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.missions.length === 0 && (
              <div className={styles.empty}>No missions dispatched yet.</div>
            )}
          </div>
        </div>

        {selectedMission && (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Tasks ({missionTasks.length})</h2>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Agent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {missionTasks.map((t) => (
                    <tr key={t.task_id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                        {t.error && (
                          <div style={{ fontSize: 11, color: 'var(--theme-danger)', marginTop: 3 }}>
                            {t.error}
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'var(--theme-font-mono)', fontSize: 11 }}>
                        {t.assigned_agent_id}
                      </td>
                      <td><StatusChip status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missionTasks.length === 0 && (
                <div className={styles.empty}>No tasks for this mission.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
