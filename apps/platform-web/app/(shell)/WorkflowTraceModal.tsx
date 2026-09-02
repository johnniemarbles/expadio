'use client';

import { useEffect, useState } from 'react';

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
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--surface, #fff)', color: 'var(--ink, #0f172a)', borderRadius: 12, padding: 20, width: 'min(560px, 100%)', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-500, #64748b)' }}>Append-only transitions and immutable decisions, in order. This is the governed audit trail.</p>
        {error && <p role="alert" style={{ color: 'var(--theme-danger)', margin: 0, fontSize: 13 }}>{error}</p>}
        {entries === null && !error && <p style={{ fontSize: 13, color: 'var(--ink-500, #64748b)' }}>Loading…</p>}
        {entries !== null && entries.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-500, #64748b)' }}>No trace yet — start the workflow and advance it to build a history.</p>}
        {entries !== null && entries.length > 0 && (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, overflowY: 'auto' }}>
            {entries.map((e, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderLeft: `3px solid ${e.kind === 'DECISION' ? 'var(--theme-success)' : '#4f46e5'}`, paddingLeft: 10 }}>
                <span style={{ fontSize: 10, color: 'var(--ink-500, #64748b)', minWidth: 132 }}>{new Date(e.at).toLocaleString()}</span>
                <span style={{ fontSize: 13 }}>
                  {e.kind === 'TRANSITION' ? (
                    <>
                      <strong>{e.fromStageKey ?? '—'}</strong> → <strong>{e.toStageKey}</strong>
                      <span style={{ fontSize: 11, color: 'var(--ink-500, #64748b)' }}> · rev {e.revision} · {e.bySubjectId}{e.reason ? ` · “${e.reason}”` : ''}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 800, color: 'var(--theme-success)', background: '#dcfce7' }}>DECISION</span>{' '}
                      <strong>{e.outcome}</strong> on <strong>{e.stageKey}</strong>
                      <span style={{ fontSize: 11, color: 'var(--ink-500, #64748b)' }}> · {e.bySubjectId}</span>
                      {e.evidenceRefs && e.evidenceRefs.length > 0 && (
                        <span style={{ display: 'block', marginTop: 2 }}>
                          {e.evidenceRefs.map((ref) => (
                            <code key={ref} style={{ fontSize: 10, color: 'var(--ink-500, #64748b)', background: 'var(--surface-2, #f1f5f9)', padding: '1px 5px', borderRadius: 4, marginRight: 4 }}>{ref}</code>
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
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--line, #cbd5e1)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
