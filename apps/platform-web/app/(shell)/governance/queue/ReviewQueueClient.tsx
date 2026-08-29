'use client';

import { useState } from 'react';
import { findIndustryPack, resolveWorkTypeLabel, resolveStageLabel } from '@expadio/industry-packs';
import styles from '../../workflows/page.module.css';

/**
 * The reviewer's cross-vertical inbox — every open governed instance waiting on
 * the signed-in participant to act, across case, vendor, expense and access
 * request. Oldest-waiting first, and actionable in place: the governed action
 * endpoint records a decision on any vertical without leaving the queue.
 */

export interface ReviewQueueItem {
  workTypeKey: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string | null;
  state: string;
  currentStageKey: string;
  participantKey: string;
  revision: number;
  waitingSince: string;
}

type GovernedAction =
  | { type: 'DECIDE'; outcomes: string[] }
  | { type: 'ASSIGN'; slots: string[] };

type ActState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; outcomes: string[]; other: boolean };

// Where the work is actioned in full — each vertical owns its own console page.
const VERTICAL_HREF: Record<string, string> = {
  'crm.case': '/crm',
  'vendor.onboarding': '/vendors',
  'expense.reimbursement': '/expenses',
  'access.request': '/access-requests',
};

const sinceLabel = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(0, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const ageColor = (iso: string): string => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h >= 72) return '#b91c1c';
  if (h >= 24) return '#b45309';
  return '#64748b';
};

const outcomeColor = (o: string): string => {
  const up = o.toUpperCase();
  if (up.includes('APPROVE') || up.includes('GRANT')) return '#166534';
  if (up.includes('REJECT') || up.includes('DENY') || up.includes('RETURN')) return '#b91c1c';
  return '#475569';
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };
const badge: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#b45309', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 999, padding: '1px 9px', marginLeft: 8, verticalAlign: 'middle' };
const chip = (color: string): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, color, background: 'transparent', border: `1px solid ${color}`, borderRadius: 6, padding: '3px 9px', cursor: 'pointer' });

const keyOf = (d: ReviewQueueItem) => `${d.workTypeKey}:${d.subjectId}`;

export function ReviewQueueClient({ initial, verticalKey = null }: { initial: ReviewQueueItem[]; verticalKey?: string | null }) {
  const pack = findIndustryPack(verticalKey);
  const [items, setItems] = useState<ReviewQueueItem[]>(initial);
  const [workType, setWorkType] = useState('');
  const [acts, setActs] = useState<Record<string, ActState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  const workTypes = Array.from(new Set(items.map((d) => d.workTypeKey))).sort();
  const rows = workType === '' ? items : items.filter((d) => d.workTypeKey === workType);

  async function loadActions(d: ReviewQueueItem) {
    const k = keyOf(d);
    setActs((p) => ({ ...p, [k]: { status: 'loading' } }));
    try {
      const res = await fetch(`/api/governance/actions?workType=${encodeURIComponent(d.workTypeKey)}&subject=${encodeURIComponent(d.subjectId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not load actions.');
      const actions = (data.actions ?? []) as GovernedAction[];
      const decide = actions.find((a) => a.type === 'DECIDE');
      const outcomes = decide && decide.type === 'DECIDE' ? decide.outcomes : [];
      // "Open to act" covers work the queue itself doesn't perform inline: a
      // participant assignment, or a stage that's ready to advance in the vertical.
      const other = actions.some((a) => a.type === 'ASSIGN') || data.canAdvance === true;
      setActs((p) => ({ ...p, [k]: { status: 'ready', outcomes, other } }));
    } catch (cause) {
      setActs((p) => ({ ...p, [k]: { status: 'error', message: cause instanceof Error ? cause.message : 'Could not load actions.' } }));
    }
  }

  async function decide(d: ReviewQueueItem, outcome: string) {
    const k = keyOf(d);
    setBusy(k);
    try {
      const res = await fetch('/api/governance/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workType: d.workTypeKey, subject: d.subjectId, action: 'DECIDE', outcome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not record the decision.');
      // The item is decided — drop it from the queue with a brief confirmation.
      setDone((p) => ({ ...p, [k]: outcome }));
      setItems((prev) => prev.filter((x) => keyOf(x) !== k));
    } catch (cause) {
      setActs((p) => ({ ...p, [k]: { status: 'error', message: cause instanceof Error ? cause.message : 'Could not record the decision.' } }));
    } finally {
      setBusy(null);
    }
  }

  const recentlyDone = Object.entries(done);

  return (
    <section className={styles.panel} aria-labelledby="rq-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Awaiting you</p><h2 id="rq-title">Your review queue{items.length > 0 && <span style={badge}>{items.length}</span>}</h2></div>
        <select style={inp} value={workType} onChange={(e) => setWorkType(e.target.value)} aria-label="Filter by work type">
          <option value="">All work types</option>
          {workTypes.map((wt) => <option key={wt} value={wt}>{resolveWorkTypeLabel(pack, wt)}</option>)}
        </select>
      </div>

      {recentlyDone.length > 0 && (
        <p style={{ fontSize: 13, color: '#166534', margin: '0 0 12px' }}>
          Recorded {recentlyDone.length} decision{recentlyDone.length === 1 ? '' : 's'} from the queue.
        </p>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          Nothing is waiting on you right now. Items appear here when a governed process stops on a stage assigned to you.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Work type</th><th>Subject</th><th>Stage</th><th>Your slot</th><th>Waiting</th><th>Act</th></tr></thead>
            <tbody>
              {rows.map((d) => {
                const k = keyOf(d);
                const href = VERTICAL_HREF[d.workTypeKey];
                const act = acts[k];
                return (
                  <tr key={k}>
                    <td title={pack ? d.workTypeKey : undefined}>{resolveWorkTypeLabel(pack, d.workTypeKey)}</td>
                    <td>{d.subjectLabel ? <>{d.subjectLabel} <span style={{ color: '#94a3b8' }}>· {d.subjectType}</span></> : <>{d.subjectType} · <code>{d.subjectId.slice(0, 8)}</code></>}</td>
                    <td title={pack ? d.currentStageKey : undefined}>{resolveStageLabel(pack, d.workTypeKey, d.currentStageKey)}</td>
                    <td>{d.participantKey}</td>
                    <td style={{ color: ageColor(d.waitingSince), fontWeight: 600 }}>{sinceLabel(d.waitingSince)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {act === undefined && (
                          <button type="button" onClick={() => loadActions(d)} style={chip('#2563eb')}>Act ▾</button>
                        )}
                        {act?.status === 'loading' && <span style={{ fontSize: 12, color: '#64748b' }}>Loading…</span>}
                        {act?.status === 'error' && <span role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{act.message}</span>}
                        {act?.status === 'ready' && act.outcomes.length > 0 && act.outcomes.map((o) => (
                          <button key={o} type="button" disabled={busy === k} onClick={() => decide(d, o)} style={chip(outcomeColor(o))}>{o}</button>
                        ))}
                        {act?.status === 'ready' && act.outcomes.length === 0 && (
                          <span style={{ fontSize: 12, color: '#64748b' }}>{act.other ? 'Open to act' : 'No action'}</span>
                        )}
                        {href ? <a href={href} style={{ color: '#2563eb', fontSize: 13 }}>Open</a> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
