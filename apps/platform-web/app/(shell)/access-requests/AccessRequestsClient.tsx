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

const badgeClass = (state: string): string => {
  if (state === 'GRANTED') return [styles.statusBadge, styles.statusPositive].join(' ');
  if (state === 'SUBMITTED') return [styles.statusBadge, styles.statusWarning].join(' ');
  if (state === 'REJECTED') return [styles.statusBadge, styles.statusDanger].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
};

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
        <div className={styles.toolbar}>
          <input className={styles.field} placeholder="Resource (e.g. prod-db:read)" value={resource} onChange={(e) => setResource(e.target.value)} aria-label="Requested resource" />
          <input className={styles.field} placeholder="Justification (optional)" value={justification} onChange={(e) => setJustification(e.target.value)} aria-label="Justification" />
          <button className={styles.button} onClick={file} disabled={busy !== null || resource.trim() === ''}>{busy === 'file' ? 'Filing…' : 'File request'}</button>
        </div>
      </div>

      {error && (
        <p role="alert" className={[styles.inlineAlert, styles.inlineAlertDanger].join(' ')}>
          {error}
          {authHint && <> · <a href={`/authority${queryString}`} className={styles.inlineLink}>Grant approval authority →</a></>}
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
                  <td><span className={badgeClass(r.status)}>{r.status}</span></td>
                  <td>{stage ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    <span className={styles.toolbar}>
                      {r.workflowInstanceId === null ? (
                        <button className={styles.button} disabled={busy !== null} onClick={() => start(r.accessRequestId)}>Start review</button>
                      ) : stage === 'SUBMITTED' ? (
                        <>
                          <button className={[styles.button, styles.buttonSecondary].join(' ')} disabled={busy !== null} onClick={() => assignReviewer(r.accessRequestId)}>Assign reviewer</button>
                          <button className={styles.button} disabled={busy !== null} onClick={() => advance(r.accessRequestId, 'SECURITY_REVIEW')}>Send to review</button>
                        </>
                      ) : stage === 'SECURITY_REVIEW' ? (
                        <>
                          <button className={styles.button} disabled={busy !== null} onClick={() => approveAndGrant(r.accessRequestId)}>Approve &amp; grant</button>
                          <button className={[styles.button, styles.buttonDanger].join(' ')} disabled={busy !== null} onClick={() => reject(r.accessRequestId)}>Reject</button>
                        </>
                      ) : (
                        <span className={styles.muted}>Granted</span>
                      )}
                      {r.workflowInstanceId !== null && (
                        <button type="button" className={[styles.button, styles.buttonGhost].join(' ')} onClick={() => setTrace(r)}>Trace</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className={styles.emptyRow}>No access requests yet. File one to begin.</p>}
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
