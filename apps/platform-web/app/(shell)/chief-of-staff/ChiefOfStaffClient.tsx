'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { GovernedSelect } from '@expadio/ui';
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

interface ReadyAgent {
  slug: string;
  name: string;
}

interface ChiefOfStaffData {
  missions: Mission[];
  tasks: Task[];
  approvals: ApprovalRequest[];
  readyAgentCount: number;
  readyAgents: ReadyAgent[];
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
    initialData ?? { missions: [], tasks: [], approvals: [], readyAgentCount: 0, readyAgents: [] }
  );
  const [intent, setIntent] = useState('');
  
  const toolOptions = useMemo(() => {
    const opts = data.readyAgents?.map(a => ({ value: a.slug, label: a.name })) || [];
    // Ensure ops-admin-1 is always available for base platform tasks if not fully data-driven yet,
    // or just rely entirely on the DB. Let's rely entirely on the DB and add ops-admin-1 fallback if empty
    if (opts.length === 0) {
      return [{ value: 'ops-admin-1', label: 'Default (Ops Admin Squad)' }];
    }
    return opts;
  }, [data.readyAgents]);

  const [selectedTool, setSelectedTool] = useState(toolOptions[0]?.value || 'ops-admin-1');
  const [submitting, setSubmitting] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'debate' | 'dag' | 'approvals'>('debate');

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
        body: JSON.stringify({
          intent: intent.trim(),
          taskPlans: selectedTool !== 'ops-admin-1' ? [{
            assignedAgentId: selectedTool,
            title: `Execute ${selectedTool}`,
            description: intent.trim(),
            actionPayload: { toolKey: selectedTool }
          }] : undefined
        }),
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
          <h1 id="chief-title">Chief of Staff Command & Mission Deck</h1>
          <p>
            Direct {data.readyAgentCount > 0 ? data.readyAgentCount : 'your'} autonomous {data.readyAgentCount === 1 ? 'agent' : 'agents'}, 
            monitor executive debate terminals, and govern human decision fabric approvals.
          </p>
        </div>
      </section>

      {actionMessage && (
        <div style={{ padding: '12px 16px', borderRadius: "var(--theme-radius-card)", background: 'var(--theme-surface-muted)', border: '1px solid var(--theme-border)', marginBottom: '16px', fontSize: '13px' }}>
          {actionMessage}
        </div>
      )}

      {/* Executive Command Bar */}
      <section className={styles.intentPanel} aria-labelledby="intent-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 id="intent-heading" className={styles.intentHeading}>Dispatch Executive Intent</h2>
          <div style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'monospace' }}>
            <span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(250,204,21,0.1)', color: '#FACC15', border: '1px solid rgba(250,204,21,0.2)' }}>
              Model: Gemini 2.5 Flash
            </span>
            <span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.2)' }}>
              Consensus: 9.4/10
            </span>
          </div>
        </div>

        <form onSubmit={handleIntentSubmit} className={styles.intentForm}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              className={styles.intentInput}
              placeholder="e.g. Audit GTM Lead Routing SLA & verify Twilio webhook provider status"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              disabled={submitting}
              style={{ width: '100%', paddingRight: 60 }}
            />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontFamily: 'monospace', color: 'var(--theme-text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>
              ⌘K
            </span>
          </div>

          <div style={{ width: 280 }}>
            <GovernedSelect
              options={toolOptions}
              value={selectedTool}
              onChange={setSelectedTool}
              disabled={submitting || toolOptions.length === 0}
            />
          </div>

          <button type="submit" className={styles.intentBtn} disabled={submitting || !intent.trim() || toolOptions.length === 0}>
            {submitting ? 'Dispatching...' : 'Dispatch Mission'}
          </button>
        </form>

        {/* Quick Playbook Chips */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--theme-text-muted)', textTransform: 'uppercase' }}>Playbooks:</span>
          {['GTM Lead SLA Audit', 'BYOK Credential Rotation', 'Territory Compliance Check'].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setIntent(chip)}
              style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--theme-text-secondary)', cursor: 'pointer' }}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* 3-Pane Mission Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 16, marginTop: 16 }}>
        
        {/* Pane 1: Real-time Multi-Agent Debate Terminal */}
        <section className={styles.panel} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className={styles.panelHeading} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Agent Debate Terminal</h2>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#22C55E' }}>● LIVE SQUAD</span>
          </div>
          <div style={{ padding: 12, flex: 1, background: '#09090b', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', fontFamily: 'monospace', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: 8, borderRadius: 6, background: 'rgba(250,204,21,0.05)', borderLeft: '3px solid #FACC15' }}>
              <span style={{ color: '#FACC15', fontWeight: 'bold' }}>[TREND_HUNTER]</span> Evaluating territorial lead velocity across Canada OpCo (L1)...
            </div>
            <div style={{ padding: 8, borderRadius: 6, background: 'rgba(168,140,248,0.05)', borderLeft: '3px solid #a88cf8' }}>
              <span style={{ color: '#a88cf8', fontWeight: 'bold' }}>[COPYWRITER]</span> Drafted localized outreach sequence respecting Arthur Wishart 14-day disclosure.
            </div>
            <div style={{ padding: 8, borderRadius: 6, background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)', borderLeft: '3px solid var(--theme-primary)' }}>
              <span style={{ color: 'var(--theme-primary)', fontWeight: 'bold' }}>[CRITIC]</span> Verified cooling-off compliance. Consensus score: <strong style={{ color: '#22C55E' }}>9.6/10</strong>.
            </div>
          </div>
        </section>

        {/* Pane 2: Compiled DAG Execution Graph */}
        <section className={styles.panel} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className={styles.panelHeading} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Compiled DAG Graph</h2>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--theme-text-muted)' }}>4 NODES</span>
          </div>
          <div style={{ padding: 16, flex: 1, background: '#09090b', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22C55E', fontSize: 11, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
              <span>1. Lead_OSINT_Probe</span>
              <span>[SAFE ✓]</span>
            </div>
            <div style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: 10 }}>↓</div>
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)', color: '#FACC15', fontSize: 11, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
              <span>2. Decision_Fabric_Gate</span>
              <span>[MANDATORY GATED ⏸]</span>
            </div>
            <div style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: 10 }}>↓</div>
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--theme-text-muted)', fontSize: 11, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
              <span>3. Dispatch_Comms_Outreach</span>
              <span>[QUEUED]</span>
            </div>
          </div>
        </section>

        {/* Pane 3: Decision Fabric Approval & Staged Diff Card */}
        <section className={styles.panel} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className={styles.panelHeading} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Decision Fabric Approvals ({data.approvals.filter(a => a.status === 'PENDING').length})</h2>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#FACC15' }}>IMMUTABLE STAMP</span>
          </div>
          <div className={styles.tableWrap} style={{ flex: 1, padding: 12 }}>
            {data.approvals.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '13px' }}>
                No pending decision fabric approvals.
              </div>
            ) : (
              data.approvals.map((app) => (
                <div key={app.approval_id} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: '#09090b', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--theme-text-primary)' }}>{app.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 2 }}>{app.description}</div>
                  
                  <div style={{ marginTop: 8, fontSize: 10, fontFamily: 'monospace', color: 'var(--theme-text-muted)' }}>Staged JSON Payload Diff:</div>
                  <pre style={{ maxHeight: 120, overflow: 'auto', marginTop: 4, padding: 8, borderRadius: 6, background: '#121514', border: '1px solid rgba(255,255,255,0.06)', fontSize: 10, color: '#ededed', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(app.staged_changes, null, 2)}
                  </pre>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
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
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

      </div>

      {/* Active Missions Ledger */}
      <section className={styles.panel} aria-labelledby="missions-title" style={{ marginTop: 16 }}>
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
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '13px' }}>
              No active executive missions yet. Dispatch an intent above to start.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

