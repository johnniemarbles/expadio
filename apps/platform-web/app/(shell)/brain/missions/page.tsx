'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

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
  status: string;
  created_at: string;
}

interface MissionsData {
  missions: Mission[];
  tasks: Task[];
  approvals: ApprovalRequest[];
}

function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === 'COMPLETED' || s === 'APPROVED') return 'var(--theme-success)';
  if (s === 'FAILED' || s === 'REJECTED') return 'var(--theme-danger)';
  if (s === 'IN_PROGRESS' || s === 'RUNNING') return 'var(--theme-primary)';
  if (s === 'AWAITING_APPROVAL' || s === 'PENDING') return 'var(--theme-warning)';
  return 'var(--theme-text-secondary)';
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
      color, background: `color-mix(in srgb,${color} 10%,transparent)`,
      border: `1px solid color-mix(in srgb,${color} 25%,var(--theme-border))`,
    }}>
      {status}
    </span>
  );
}

const card: React.CSSProperties = {
  background: 'var(--theme-surface)',
  border: '1px solid var(--theme-border)',
  borderRadius: 10,
  overflow: 'hidden',
};

const cardHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 18px', borderBottom: '1px solid var(--theme-border)',
};

const headingStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: 'var(--theme-text-primary)', margin: 0,
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 12,
};

const thStyle: React.CSSProperties = {
  padding: '8px 14px', textAlign: 'left', fontWeight: 600,
  color: 'var(--theme-text-secondary)', borderBottom: '1px solid var(--theme-border)',
  fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', borderBottom: '1px solid var(--theme-border)',
  color: 'var(--theme-text-primary)', verticalAlign: 'top',
};

export default function PlatformMissionsPage() {
  const [data, setData] = useState<MissionsData>({ missions: [], tasks: [], approvals: [] });
  const [intent, setIntent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'info' | 'error'>('info');
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [streamingMissionId, setStreamingMissionId] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/missions');
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
    const timer = setInterval(refresh, 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  const startStream = useCallback((missionId: string) => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/api/agent/missions/${missionId}/events`);
    sseRef.current = es;
    setStreamingMissionId(missionId);

    es.addEventListener('snapshot', () => refresh());
    es.addEventListener('done', () => {
      refresh();
      es.close();
      sseRef.current = null;
      setStreamingMissionId(null);
    });
    es.addEventListener('error', () => {
      es.close();
      sseRef.current = null;
      setStreamingMissionId(null);
    });
  }, [refresh]);

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const dispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/agent/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: intent.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setIntent('');
        setNotice(`Mission dispatched — ${json.missionId}`);
        setNoticeKind('info');
        await refresh();
        startStream(json.missionId);
        setSelectedMission(json.missionId);
      } else {
        setNotice(`Error: ${json.error ?? 'Unknown'}`);
        setNoticeKind('error');
      }
    } catch (err) {
      setNotice(`Network error: ${err instanceof Error ? err.message : 'Failed'}`);
      setNoticeKind('error');
    } finally {
      setSubmitting(false);
    }
  };

  const resolveApproval = async (missionId: string, approvalId: string, approved: boolean) => {
    const res = await fetch(`/api/agent/missions/${missionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, approved }),
    });
    if (res.ok) {
      setNotice(`Approval ${approved ? 'approved' : 'rejected'}.`);
      setNoticeKind('info');
      await refresh();
    }
  };

  const handleSelectMission = (missionId: string) => {
    const next = missionId === selectedMission ? null : missionId;
    setSelectedMission(next);
    if (next) {
      const m = data.missions.find((m) => m.mission_id === next);
      const terminal = m?.status === 'COMPLETED' || m?.status === 'FAILED';
      if (!terminal) startStream(next);
    } else {
      sseRef.current?.close();
      sseRef.current = null;
      setStreamingMissionId(null);
    }
  };

  const missionTasks = selectedMission
    ? data.tasks.filter((t) => t.mission_id === selectedMission)
    : [];
  const pendingApprovals = data.approvals.filter((a) => a.status === 'PENDING');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--theme-text-primary)', margin: '0 0 .25rem' }}>
          Executive Missions
        </h2>
        <p style={{ fontSize: 13, color: 'var(--theme-text-secondary)', margin: 0 }}>
          Dispatch governed intelligence requests and track autonomous task execution across the platform.
        </p>
      </div>

      <form onSubmit={dispatch} style={{ display: 'flex', gap: 10 }}>
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          disabled={submitting}
          placeholder="e.g. Analyse onboarding completion rate and surface blockers"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            border: '1px solid var(--theme-border)', background: 'var(--theme-surface)',
            color: 'var(--theme-text-primary)', outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={submitting || !intent.trim()}
          style={{
            padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'var(--theme-primary)', color: 'var(--theme-surface)', border: 'none',
            cursor: submitting || !intent.trim() ? 'not-allowed' : 'pointer',
            opacity: submitting || !intent.trim() ? 0.6 : 1, minWidth: 150,
          }}
        >
          {submitting ? 'Dispatching…' : 'Dispatch Mission'}
        </button>
      </form>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: noticeKind === 'error'
            ? 'color-mix(in srgb,var(--theme-danger) 8%,var(--theme-surface))'
            : 'var(--theme-surface)',
          border: `1px solid ${noticeKind === 'error' ? 'var(--theme-danger)' : 'var(--theme-border)'}`,
          color: noticeKind === 'error' ? 'var(--theme-danger)' : 'var(--theme-text-primary)',
        }}>
          {notice}
        </div>
      )}

      {pendingApprovals.length > 0 && (
        <div style={card}>
          <div style={cardHead}>
            <h3 style={{ ...headingStyle, color: 'var(--theme-warning)' }}>
              Pending Approvals ({pendingApprovals.length})
            </h3>
          </div>
          <div style={{ padding: '4px 18px 14px' }}>
            {pendingApprovals.map((a) => (
              <div key={a.approval_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '12px 0', borderBottom: '1px solid var(--theme-border)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                  {a.description && (
                    <div style={{ fontSize: 11, color: 'var(--theme-text-secondary)', marginTop: 3 }}>
                      {a.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    style={{
                      padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      background: 'var(--theme-success)', color: 'var(--theme-surface)', border: 'none', cursor: 'pointer',
                    }}
                    onClick={() => resolveApproval(a.mission_id, a.approval_id, true)}
                  >
                    Approve
                  </button>
                  <button
                    style={{
                      padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      background: 'transparent', cursor: 'pointer',
                      color: 'var(--theme-danger)',
                      border: '1px solid var(--theme-danger)',
                    }}
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

      <div style={{
        display: 'grid',
        gridTemplateColumns: selectedMission ? '1fr 1fr' : '1fr',
        gap: '1rem',
        alignItems: 'start',
      }}>
        <div style={card}>
          <div style={cardHead}>
            <h3 style={headingStyle}>Missions ({data.missions.length})</h3>
            {selectedMission && (
              <button
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-secondary)',
                }}
                onClick={() => handleSelectMission(selectedMission)}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Intent</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, whiteSpace: 'nowrap' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.missions.map((m) => (
                  <tr
                    key={m.mission_id}
                    style={{
                      cursor: 'pointer',
                      background: selectedMission === m.mission_id
                        ? 'color-mix(in srgb,var(--theme-primary) 6%,transparent)'
                        : undefined,
                    }}
                    onClick={() => handleSelectMission(m.mission_id)}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {streamingMissionId === m.mission_id && (
                          <span style={{
                            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                            background: 'var(--theme-primary)', flexShrink: 0,
                            animation: 'pulse 1.4s ease-in-out infinite',
                          }} />
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.intent}
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}><StatusBadge status={m.status} /></td>
                    <td style={{ ...tdStyle, color: 'var(--theme-text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.missions.length === 0 && (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--theme-text-secondary)', fontSize: 13 }}>
                No missions dispatched yet.
              </div>
            )}
          </div>
        </div>

        {selectedMission && (
          <div style={card}>
            <div style={cardHead}>
              <h3 style={headingStyle}>
                Tasks ({missionTasks.length})
                {streamingMissionId === selectedMission && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--theme-primary)', fontWeight: 500 }}>
                    live
                  </span>
                )}
              </h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Agent</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {missionTasks.map((t) => (
                    <tr key={t.task_id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                        {t.error && (
                          <div style={{ fontSize: 11, color: 'var(--theme-danger)', marginTop: 3 }}>
                            {t.error}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: 'var(--theme-text-secondary)' }}>
                        {t.assigned_agent_id}
                      </td>
                      <td style={tdStyle}><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missionTasks.length === 0 && (
                <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--theme-text-secondary)', fontSize: 13 }}>
                  No tasks yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    </div>
  );
}
