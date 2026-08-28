'use client';

import { useState } from 'react';
import styles from '../workflows/page.module.css';
import { WorkflowTraceModal } from '../WorkflowTraceModal';

/**
 * Access request surface — the fourth Decision Fabric vertical. File a request
 * for a system entitlement, route it to a security reviewer, and approve it to
 * GRANTED. The review approval is gated by role + separation of duties (the
 * reviewer cannot be the requester), on the same engine as the other verticals.
 */

export interface AccessRequestRow {
  accessRequestId: string;
  resource: string;
  justification: string | null;
  status: string;
  blueprintKey: string | null;
  workflowInstanceId: string | null;
  stageKey: string | null;
  createdAt: string;
}

interface WfState { instanceId: string; currentStageKey: string | null; revision: number; state: string }

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (typeof r.error === 'string') return r.error;
    if (typeof r.message === 'string') return r.message;
  }
  return fallback;
}

const badge = (state: string): React.CSSProperties => {
  const map: Record<string, string> = { GRANTED: '#0f766e', SUBMITTED: '#b45309', REJECTED: '#b91c1c' };
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: '#fff', background: map[state] ?? '#64748b' };
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' };

export function AccessRequestsClient({ initial, queryString = '' }: { initial: AccessRequestRow[]; queryString?: string }) {
  const [rows, setRows] = useState<AccessRequestRow[]>(initial);
  const [resource, setResource] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState(false);
  const [wf, setWf] = useState<Record<string, WfState>>({});
  const [trace, setTrace] = useState<AccessRequestRow | null>(null);

  async function reload() {
    const res = await fetch(`/api/access-requests${queryString}`);
    if (res.ok) setRows(await res.json());
  }

  async function file() {
    if (resource.trim() === '') return;
    setBusy('file'); setError(null);
    try {
      const res = await fetch(`/api/access-requests${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource, justification: justification || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not file the request.'));
      setResource(''); setJustification('');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not file the request.'); }
    finally { setBusy(null); }
  }

  async function loadWorkflow(id: string): Promise<WfState | null> {
    const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/workflow${queryString}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.instance) return null;
    const state: WfState = { instanceId: data.instance.instanceId, currentStageKey: data.instance.currentStageKey ?? null, revision: data.instance.revision, state: data.instance.state };
    setWf((m) => ({ ...m, [id]: state }));
    return state;
  }

  async function start(id: string) {
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/workflow${queryString}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not start the review.'));
      await loadWorkflow(id); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the review.'); }
    finally { setBusy(null); }
  }

  async function assignReviewer(id: string) {
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/workflow/participants${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageKey: 'SECURITY_REVIEW', participantKey: 'security_reviewer' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not assign a reviewer.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not assign a reviewer.'); }
    finally { setBusy(null); }
  }

  async function advance(id: string, toStageKey: string) {
    const state = wf[id] ?? await loadWorkflow(id);
    if (!state) return;
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/workflow${queryString}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageKey, expectedRevision: state.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, `Could not advance to ${toStageKey}.`));
      await loadWorkflow(id); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not advance the request.'); }
    finally { setBusy(null); }
  }

  async function decide(id: string, outcome: 'APPROVE' | 'REJECT'): Promise<void> {
    setAuthHint(false);
    const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/workflow/decision${queryString}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (typeof data?.code === 'string' && data.code.startsWith('WORKFLOW_AUTHORITY')) setAuthHint(true);
      throw new Error(apiError(data, 'Could not record the decision.'));
    }
  }

  async function approveAndGrant(id: string) {
    const state = wf[id] ?? await loadWorkflow(id);
    if (!state) return;
    setBusy(id); setError(null);
    try {
      await decide(id, 'APPROVE');
      const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/workflow${queryString}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageKey: 'GRANTED', expectedRevision: state.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not grant the request.'));
      await loadWorkflow(id); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not approve the request.'); }
    finally { setBusy(null); }
  }

  async function reject(id: string) {
    setBusy(id); setError(null);
    try {
      await decide(id, 'REJECT');
      await loadWorkflow(id); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reject the request.'); }
    finally { setBusy(null); }
  }

  return (
    <section className={styles.panel} aria-labelledby="access-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Access</p><h2 id="access-title">Access requests</h2></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={inp} placeholder="Resource (e.g. prod-db:read)" value={resource} onChange={(e) => setResource(e.target.value)} aria-label="Requested resource" />
          <input style={inp} placeholder="Justification (optional)" value={justification} onChange={(e) => setJustification(e.target.value)} aria-label="Justification" />
          <button style={btn} onClick={file} disabled={busy !== null || resource.trim() === ''}>{busy === 'file' ? 'Filing…' : 'File request'}</button>
        </div>
      </div>

      {error && (
        <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>
          {error}
          {authHint && <> · <a href={`/authority${queryString}`} style={{ color: '#0f766e', fontWeight: 600 }}>Grant approval authority →</a></>}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Resource</th><th>Status</th><th>Stage</th><th>Review</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const stage = r.stageKey;
              return (
                <tr key={r.accessRequestId}>
                  <td><strong>{r.resource}</strong>{r.justification ? <><br /><span className={styles.muted}>{r.justification}</span></> : null}</td>
                  <td><span style={badge(r.status)}>{r.status}</span></td>
                  <td>{stage ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      {r.workflowInstanceId === null ? (
                        <button style={btn} disabled={busy !== null} onClick={() => start(r.accessRequestId)}>Start review</button>
                      ) : stage === 'SUBMITTED' ? (
                        <>
                          <button style={{ ...btn, background: '#334155' }} disabled={busy !== null} onClick={() => assignReviewer(r.accessRequestId)}>Assign reviewer</button>
                          <button style={btn} disabled={busy !== null} onClick={() => advance(r.accessRequestId, 'SECURITY_REVIEW')}>Send to review</button>
                        </>
                      ) : stage === 'SECURITY_REVIEW' ? (
                        <>
                          <button style={btn} disabled={busy !== null} onClick={() => approveAndGrant(r.accessRequestId)}>Approve &amp; grant</button>
                          <button style={{ ...btn, background: '#b91c1c' }} disabled={busy !== null} onClick={() => reject(r.accessRequestId)}>Reject</button>
                        </>
                      ) : (
                        <span className={styles.muted}>Granted</span>
                      )}
                      {r.workflowInstanceId !== null && (
                        <button type="button" style={{ ...btn, background: 'transparent', color: 'var(--ink-600, #475569)', border: '1px solid var(--line, #cbd5e1)' }} onClick={() => setTrace(r)}>Trace</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No access requests yet. File one to begin.</p>}
      </div>

      {trace && (
        <WorkflowTraceModal
          title={`Workflow trace — ${trace.resource}`}
          historyUrl={`/api/access-requests/${encodeURIComponent(trace.accessRequestId)}/workflow/history${queryString}`}
          onClose={() => setTrace(null)}
        />
      )}
    </section>
  );
}
