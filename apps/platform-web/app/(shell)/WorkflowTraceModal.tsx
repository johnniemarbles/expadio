'use client';

import { useEffect, useState } from 'react';
import motionStyles from './WorkflowTraceModal.module.css';

/**
 * A self-contained trace overlay for a governed workflow subject (vendor,
 * expense, …). Fetches the subject's history route and renders the append-only
 * transitions and immutable decisions as one chronological, audit-grade
 * timeline — the same shape the CRM cases surface shows.
 */

type Entry =
  | { kind: 'TRANSITION'; at: string; revision: number; fromStageKey: string | null; toStageKey: string; bySubjectId: string; reason: string | null }
  | { kind: 'DECISION'; at: string; stageKey: string; outcome: string; bySubjectId: string; code: string; evidenceRefs?: string[] };

export function WorkflowTraceModal({ title, historyUrl, onClose }: { title: string; historyUrl: string; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(historyUrl);
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not load the trace.');
        if (live) setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Could not load the trace.');
      }
    })();
    return () => { live = false; };
  }, [historyUrl]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className={motionStyles.backdrop}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={motionStyles.dialog}
        style={{ background: 'var(--theme-surface-raised)', color: 'var(--theme-text-primary)', borderRadius: 12, padding: 20, width: 'min(560px, 100%)', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 20px 60px color-mix(in srgb,var(--theme-overlay) 72%,transparent)' }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--theme-text-muted)' }}>Append-only transitions and immutable decisions, in order. This is the governed audit trail.</p>
        {error && <p role="alert" className={motionStyles.feedback} style={{ color: 'var(--theme-danger)', margin: 0, fontSize: 13 }}>{error}</p>}
        {entries === null && !error && <p className={motionStyles.feedback} style={{ fontSize: 13, color: 'var(--theme-text-muted)' }}>Loading…</p>}
        {entries !== null && entries.length === 0 && <p className={motionStyles.feedback} style={{ fontSize: 13, color: 'var(--theme-text-muted)' }}>No trace yet — start the workflow and advance it to build a history.</p>}
        {entries !== null && entries.length > 0 && (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, overflowY: 'auto' }}>
            {entries.map((e, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderLeft: `3px solid ${e.kind === 'DECISION' ? 'var(--theme-success)' : 'var(--theme-primary)'}`, paddingLeft: 10 }}>
                <span style={{ fontSize: 10, color: 'var(--theme-text-muted)', minWidth: 132 }}>{new Date(e.at).toLocaleString()}</span>
                <span style={{ fontSize: 13 }}>
                  {e.kind === 'TRANSITION' ? (
                    <>
                      <strong>{e.fromStageKey ?? '—'}</strong> → <strong>{e.toStageKey}</strong>
                      <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}> · rev {e.revision} · {e.bySubjectId}{e.reason ? ` · “${e.reason}”` : ''}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 800, color: 'var(--theme-success)', background: 'color-mix(in srgb,var(--theme-success) 12%,transparent)' }}>DECISION</span>{' '}
                      <strong>{e.outcome}</strong> on <strong>{e.stageKey}</strong>
                      <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}> · {e.bySubjectId}</span>
                      {e.evidenceRefs && e.evidenceRefs.length > 0 && (
                        <span style={{ display: 'block', marginTop: 2 }}>
                          {e.evidenceRefs.map((ref) => (
                            <code key={ref} style={{ fontSize: 10, color: 'var(--theme-text-muted)', background: 'var(--theme-surface-muted)', padding: '1px 5px', borderRadius: 4, marginRight: 4 }}>{ref}</code>
                          ))}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className={motionStyles.closeButton} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
