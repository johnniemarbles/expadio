'use client';

import { useState } from 'react';
import styles from '../workflows/page.module.css';
import { WorkflowTraceModal } from '../WorkflowTraceModal';

/**
 * Expense reimbursement surface — the third Decision Fabric vertical. File an
 * expense, start its governed workflow, assign a manager, and approve it to PAID.
 * The manager approval must clear a monetary threshold equal to the expense's
 * amount — the same authority gate as a CRM case, on a third subject type.
 */

export interface ExpenseRow {
  expenseId: string;
  purpose: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  blueprintKey: string | null;
  workflowInstanceId: string | null;
  stageKey: string | null;
  createdAt: string;
}

interface WfStage { stageKey: string; label: string; sequence: number; requiredParticipantKeys: string[] }
interface WfState { instanceId: string; currentStageKey: string | null; revision: number; state: string; stages: WfStage[] }

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (typeof r.error === 'string') return r.error;
    if (typeof r.message === 'string') return r.message;
  }
  return fallback;
}

const money = (minor: number, currency: string): string => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
};

const badge = (state: string): React.CSSProperties => {
  const map: Record<string, string> = { PAID: '#0f766e', SUBMITTED: '#b45309', APPROVED: '#2563eb', REJECTED: '#b91c1c' };
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: '#fff', background: map[state] ?? '#64748b' };
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' };

export function ExpensesClient({ initialExpenses, queryString = '' }: { initialExpenses: ExpenseRow[]; queryString?: string }) {
  const [expenses, setExpenses] = useState<ExpenseRow[]>(initialExpenses);
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wf, setWf] = useState<Record<string, WfState>>({});
  const [trace, setTrace] = useState<ExpenseRow | null>(null);

  async function reload() {
    const res = await fetch(`/api/expenses${queryString}`);
    if (res.ok) setExpenses(await res.json());
  }

  async function file() {
    const major = Number(amount);
    if (purpose.trim() === '' || !Number.isFinite(major) || major <= 0) return;
    setBusy('file'); setError(null);
    try {
      const res = await fetch(`/api/expenses${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, amountMinorUnits: Math.round(major * 100) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not file the expense.'));
      setPurpose(''); setAmount('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not file the expense.');
    } finally { setBusy(null); }
  }

  async function loadWorkflow(expenseId: string): Promise<WfState | null> {
    const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/workflow${queryString}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.instance) return null;
    const state: WfState = { instanceId: data.instance.instanceId, currentStageKey: data.instance.currentStageKey ?? null, revision: data.instance.revision, state: data.instance.state, stages: data.stages ?? [] };
    setWf((m) => ({ ...m, [expenseId]: state }));
    return state;
  }

  async function start(expenseId: string) {
    setBusy(expenseId); setError(null);
    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/workflow${queryString}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not start the review.'));
      await loadWorkflow(expenseId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the review.'); }
    finally { setBusy(null); }
  }

  async function assignManager(expenseId: string) {
    setBusy(expenseId); setError(null);
    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/workflow/participants${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageKey: 'MANAGER_REVIEW', participantKey: 'manager' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not assign a manager.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not assign a manager.'); }
    finally { setBusy(null); }
  }

  async function advance(expenseId: string, toStageKey: string) {
    const state = wf[expenseId] ?? await loadWorkflow(expenseId);
    if (!state) return;
    setBusy(expenseId); setError(null);
    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/workflow${queryString}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageKey, expectedRevision: state.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, `Could not advance to ${toStageKey}.`));
      await loadWorkflow(expenseId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not advance the expense.'); }
    finally { setBusy(null); }
  }

  async function decide(expenseId: string, outcome: 'APPROVE' | 'REJECT'): Promise<void> {
    const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/workflow/decision${queryString}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(apiError(data, 'Could not record the decision.'));
  }

  /** The manager approval: record APPROVE (must clear the amount threshold), then pay. */
  async function approveAndPay(expenseId: string) {
    const state = wf[expenseId] ?? await loadWorkflow(expenseId);
    if (!state) return;
    setBusy(expenseId); setError(null);
    try {
      await decide(expenseId, 'APPROVE');
      const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/workflow${queryString}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageKey: 'PAID', expectedRevision: state.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not pay the expense.'));
      await loadWorkflow(expenseId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not approve the expense.'); }
    finally { setBusy(null); }
  }

  async function reject(expenseId: string) {
    setBusy(expenseId); setError(null);
    try {
      await decide(expenseId, 'REJECT');
      await loadWorkflow(expenseId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reject the expense.'); }
    finally { setBusy(null); }
  }

  return (
    <section className={styles.panel} aria-labelledby="expenses-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Reimbursement</p><h2 id="expenses-title">Expenses</h2></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={inp} placeholder="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Expense purpose" />
          <input style={{ ...inp, width: 120 }} placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Expense amount" />
          <button style={btn} onClick={file} disabled={busy !== null || purpose.trim() === '' || !(Number(amount) > 0)}>{busy === 'file' ? 'Filing…' : 'File expense'}</button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Expense</th><th>Amount</th><th>Status</th><th>Stage</th><th>Reimbursement</th></tr></thead>
          <tbody>
            {expenses.map((e) => {
              const stage = e.stageKey;
              return (
                <tr key={e.expenseId}>
                  <td><strong>{e.purpose}</strong></td>
                  <td>{money(e.amountMinorUnits, e.currency)}</td>
                  <td><span style={badge(e.status)}>{e.status}</span></td>
                  <td>{stage ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      {e.workflowInstanceId === null ? (
                        <button style={btn} disabled={busy !== null} onClick={() => start(e.expenseId)}>Start review</button>
                      ) : stage === 'SUBMITTED' ? (
                        <>
                          <button style={{ ...btn, background: '#334155' }} disabled={busy !== null} onClick={() => assignManager(e.expenseId)}>Assign manager</button>
                          <button style={btn} disabled={busy !== null} onClick={() => advance(e.expenseId, 'MANAGER_REVIEW')}>Send to review</button>
                        </>
                      ) : stage === 'MANAGER_REVIEW' ? (
                        <>
                          <button style={btn} disabled={busy !== null} onClick={() => approveAndPay(e.expenseId)}>Approve &amp; pay</button>
                          <button style={{ ...btn, background: '#b91c1c' }} disabled={busy !== null} onClick={() => reject(e.expenseId)}>Reject</button>
                        </>
                      ) : (
                        <span className={styles.muted}>Reimbursed</span>
                      )}
                      {e.workflowInstanceId !== null && (
                        <button type="button" style={{ ...btn, background: 'transparent', color: 'var(--ink-600, #475569)', border: '1px solid var(--line, #cbd5e1)' }} onClick={() => setTrace(e)}>Trace</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {expenses.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No expenses yet. File one to begin.</p>}
      </div>

      {trace && (
        <WorkflowTraceModal
          title={`Workflow trace — ${trace.purpose}`}
          historyUrl={`/api/expenses/${encodeURIComponent(trace.expenseId)}/workflow/history${queryString}`}
          onClose={() => setTrace(null)}
        />
      )}
    </section>
  );
}
