'use client';

import { useState } from 'react';
import { findIndustryPack, resolveWorkTypeLabel, resolveStageLabel, resolveDecisionOutcomeLabel } from '@expadio/industry-packs';
import styles from './ReviewQueueClient.module.css';

/**
 * The reviewer's cross-vertical inbox — every open governed instance waiting on
 * the signed-in participant to act, across case, vendor, expense, access request
 * and AutoGTM. Oldest-waiting first, and actionable in place: the governed action
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
  'gtm.icp.publish': '/gtm',
  'gtm.sequence.publish': '/gtm',
  'gtm.campaign.launch': '/gtm',
  'gtm.meeting_request': '/gtm',
};

const sinceLabel = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(0, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const ageClass = (iso: string): string => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h >= 72) return styles.waitingStale;
  if (h >= 24) return styles.waitingAging;
  return styles.waitingFresh;
};

const outcomeClass = (outcome: string): string => {
  const up = outcome.toUpperCase();
  if (up.includes('APPROVE') || up.includes('GRANT')) return styles.outcomePositive;
  if (up.includes('REJECT') || up.includes('DENY') || up.includes('RETURN')) return styles.outcomeDanger;
  return styles.outcomeNeutral;
};

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
      <div className={styles.header}>
        <div className={styles.headingBlock}>
          <p className={styles.eyebrow}>Awaiting you</p>
          <div className={styles.titleRow}>
            <h2 id="rq-title" className={styles.title}>Your review queue</h2>
            {items.length > 0 && <span className={styles.countBadge}>{items.length}</span>}
          </div>
        </div>
        <select className={styles.filter} value={workType} onChange={(e) => setWorkType(e.target.value)} aria-label="Filter by work type">
          <option value="">All work types</option>
          {workTypes.map((wt) => <option key={wt} value={wt}>{resolveWorkTypeLabel(pack, wt)}</option>)}
        </select>
      </div>

      {recentlyDone.length > 0 && (
        <p className={styles.notice}>
          Recorded {recentlyDone.length} decision{recentlyDone.length === 1 ? '' : 's'} from the queue.
        </p>
      )}

      {rows.length === 0 ? (
        <p className={styles.empty}>
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
                    <td>
                      {d.subjectLabel ? (
                        <>
                          <strong>{d.subjectLabel}</strong> <span className={styles.subjectType}>· {d.subjectType}</span>
                        </>
                      ) : (
                        <span className={styles.subjectType}>{d.subjectType} · <code>{d.subjectId.slice(0, 8)}</code></span>
                      )}
                    </td>
                    <td title={pack ? d.currentStageKey : undefined}>{resolveStageLabel(pack, d.workTypeKey, d.currentStageKey)}</td>
                    <td>{d.participantKey}</td>
                    <td className={ageClass(d.waitingSince)}>{sinceLabel(d.waitingSince)}</td>
                    <td>
                      <div className={styles.actionGroup}>
                        {act === undefined && (
                          <button type="button" onClick={() => loadActions(d)} className={styles.actionButton}>Act ▾</button>
                        )}
                        {act?.status === 'loading' && <span className={styles.loading}>Loading…</span>}
                        {act?.status === 'error' && <span role="alert" className={styles.error}>{act.message}</span>}
                        {act?.status === 'ready' && act.outcomes.length > 0 && act.outcomes.map((o) => (
                          <button key={o} type="button" disabled={busy === k} onClick={() => decide(d, o)} className={`${styles.outcomeButton} ${outcomeClass(o)}`} title={pack ? o : undefined}>{resolveDecisionOutcomeLabel(pack, o)}</button>
                        ))}
                        {act?.status === 'ready' && act.outcomes.length === 0 && (
                          <span className={styles.noAction}>{act.other ? 'Open to act' : 'No action'}</span>
                        )}
                        {href ? <a href={href} className={styles.openLink}>Open</a> : null}
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
