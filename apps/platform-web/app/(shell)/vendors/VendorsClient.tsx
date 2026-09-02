'use client';

import { useMemo, useState } from 'react';
import { InlineErrorBanner } from '@expadio/ui';
import styles from './VendorsClient.module.css';
import { WorkflowTraceModal } from '../WorkflowTraceModal';

/**
 * Vendor onboarding surface — the second Decision Fabric vertical. Register a
 * vendor, start its governed workflow, and drive it through the compliance
 * screening gate to ACTIVE. Every write is a governed API call; the workflow
 * runs on the same engine as CRM cases.
 */

export interface VendorRow {
  vendorId: string;
  legalName: string;
  taxId: string | null;
  category: string | null;
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

function statusClass(status: string) {
  if (status === 'ACTIVE') return `${styles.pill} ${styles.pillHealthy}`;
  if (status === 'REJECTED' || status === 'SUSPENDED') return `${styles.pill} ${styles.pillCritical}`;
  return `${styles.pill} ${styles.pillAttention}`;
}

export function VendorsClient({ initialVendors, queryString = '' }: { initialVendors: VendorRow[]; queryString?: string }) {
  const [vendors, setVendors] = useState<VendorRow[]>(initialVendors);
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState(false);
  const [wf, setWf] = useState<Record<string, WfState>>({});
  const [trace, setTrace] = useState<VendorRow | null>(null);

  const metrics = useMemo(() => {
    const active = vendors.filter((vendor) => vendor.status === 'ACTIVE').length;
    const inWorkflow = vendors.filter((vendor) => vendor.workflowInstanceId !== null && vendor.status !== 'ACTIVE').length;
    const approval = vendors.filter((vendor) => vendor.stageKey === 'APPROVAL').length;
    return { total: vendors.length, active, inWorkflow, approval };
  }, [vendors]);

  async function reload() {
    const res = await fetch(`/api/vendors${queryString}`);
    if (res.ok) setVendors(await res.json());
  }

  async function register() {
    if (legalName.trim() === '') return;
    setBusy('register'); setError(null);
    try {
      const res = await fetch(`/api/vendors${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legalName, taxId: taxId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not register the vendor.'));
      setLegalName(''); setTaxId('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not register the vendor.');
    } finally { setBusy(null); }
  }

  async function loadWorkflow(vendorId: string): Promise<WfState | null> {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/workflow${queryString}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.instance) return null;
    const state: WfState = { instanceId: data.instance.instanceId, currentStageKey: data.instance.currentStageKey ?? null, revision: data.instance.revision, state: data.instance.state, stages: data.stages ?? [] };
    setWf((m) => ({ ...m, [vendorId]: state }));
    return state;
  }

  async function start(vendorId: string) {
    setBusy(vendorId); setError(null);
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/workflow${queryString}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not start onboarding.'));
      await loadWorkflow(vendorId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start onboarding.'); }
    finally { setBusy(null); }
  }

  async function assignScreener(vendorId: string) {
    setBusy(vendorId); setError(null);
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/workflow/participants${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageKey: 'SCREENING', participantKey: 'screener' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not assign a screener.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not assign a screener.'); }
    finally { setBusy(null); }
  }

  async function advance(vendorId: string, toStageKey: string) {
    const state = wf[vendorId] ?? await loadWorkflow(vendorId);
    if (!state) return;
    setBusy(vendorId); setError(null);
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/workflow${queryString}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageKey, expectedRevision: state.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, `Could not advance to ${toStageKey}.`));
      await loadWorkflow(vendorId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not advance the vendor.'); }
    finally { setBusy(null); }
  }

  /** Record an immutable decision (APPROVE/REJECT) against the current stage. */
  async function decide(vendorId: string, outcome: 'APPROVE' | 'REJECT'): Promise<boolean> {
    setAuthHint(false);
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/workflow/decision${queryString}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (typeof data?.code === 'string' && data.code.startsWith('WORKFLOW_AUTHORITY')) setAuthHint(true);
      throw new Error(apiError(data, 'Could not record the decision.'));
    }
    return true;
  }

  /** The compliance approval: record APPROVE, then let the vendor go ACTIVE. */
  async function approveAndActivate(vendorId: string) {
    const state = wf[vendorId] ?? await loadWorkflow(vendorId);
    if (!state) return;
    setBusy(vendorId); setError(null);
    try {
      await decide(vendorId, 'APPROVE');
      const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/workflow${queryString}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageKey: 'ACTIVE', expectedRevision: state.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not activate the vendor.'));
      await loadWorkflow(vendorId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not approve the vendor.'); }
    finally { setBusy(null); }
  }

  async function reject(vendorId: string) {
    setBusy(vendorId); setError(null);
    try {
      await decide(vendorId, 'REJECT');
      await loadWorkflow(vendorId); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reject the vendor.'); }
    finally { setBusy(null); }
  }

  return (
    <section className={styles.root} aria-labelledby="vendors-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Decision Fabric vertical</p>
          <h2 id="vendors-title" className={styles.title}>Vendors</h2>
          <p className={styles.description}>
            Register vendor subjects, start governed onboarding, assign the compliance screener, and activate approved vendors through the shared workflow engine.
          </p>
        </div>
      </header>

      <div className={styles.grid} aria-label="Vendor onboarding health">
        <article className={styles.card}><span className={styles.metricLabel}>Total vendors</span><strong className={styles.metricValue}>{metrics.total}</strong><span className={styles.metricDetail}>Registered in this tenant</span></article>
        <article className={styles.card}><span className={styles.metricLabel}>In workflow</span><strong className={styles.metricValue}>{metrics.inWorkflow}</strong><span className={styles.metricDetail}>Awaiting screening or approval</span></article>
        <article className={styles.card}><span className={styles.metricLabel}>Approval gate</span><strong className={styles.metricValue}>{metrics.approval}</strong><span className={styles.metricDetail}>Decision required</span></article>
        <article className={styles.card}><span className={styles.metricLabel}>Active</span><strong className={styles.metricValue}>{metrics.active}</strong><span className={styles.metricDetail}>Ready for business use</span></article>
      </div>

      <section className={styles.panel} aria-labelledby="vendor-register-title">
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Onboarding intake</p>
            <h3 id="vendor-register-title">Register vendor</h3>
          </div>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Legal name</span>
              <input placeholder="Legal name" value={legalName} onChange={(e) => setLegalName(e.target.value)} aria-label="Vendor legal name" />
            </label>
            <label className={styles.field}>
              <span>Tax ID</span>
              <input placeholder="Tax ID (optional)" value={taxId} onChange={(e) => setTaxId(e.target.value)} aria-label="Vendor tax ID" />
            </label>
          </div>
          <div className={styles.actionRow}>
            <button className={styles.button} onClick={register} disabled={busy !== null || legalName.trim() === ''}>{busy === 'register' ? 'Registering…' : 'Register vendor'}</button>
          </div>
        </div>
      </section>

      {error && (
        <>
          <InlineErrorBanner error={{ code: 'VENDOR_ACTION_BLOCKED', message: error }} />
          {authHint && (
            <p className={styles.remediation}>
              This decision requires WORKFLOW_AUTHORITY. <a className={styles.link} href={`/authority${queryString}`}>Grant approval authority →</a>
            </p>
          )}
        </>
      )}

      <section className={styles.panel} aria-labelledby="vendor-list-title">
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Governed queue</p>
            <h3 id="vendor-list-title">Vendor onboarding</h3>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Vendor</th><th>Status</th><th>Stage</th><th>Onboarding</th></tr></thead>
            <tbody>
              {vendors.map((v) => {
                const stage = v.stageKey;
                return (
                  <tr key={v.vendorId}>
                    <td><strong>{v.legalName}</strong>{v.taxId ? <><br /><span className={styles.muted}>{v.taxId}</span></> : null}</td>
                    <td><span className={statusClass(v.status)}>{v.status}</span></td>
                    <td>{stage ?? <span className={styles.muted}>—</span>}</td>
                    <td>
                      <span className={styles.rowActions}>
                        {v.workflowInstanceId === null ? (
                          <button className={styles.button} disabled={busy !== null} onClick={() => start(v.vendorId)}>Start onboarding</button>
                        ) : stage === 'SUBMITTED' ? (
                          <>
                            <button className={styles.secondaryButton} disabled={busy !== null} onClick={() => assignScreener(v.vendorId)}>Assign screener</button>
                            <button className={styles.button} disabled={busy !== null} onClick={() => advance(v.vendorId, 'SCREENING')}>Advance to screening</button>
                          </>
                        ) : stage === 'SCREENING' ? (
                          <button className={styles.button} disabled={busy !== null} onClick={() => advance(v.vendorId, 'APPROVAL')}>Advance to approval</button>
                        ) : stage === 'APPROVAL' ? (
                          <>
                            <button className={styles.button} disabled={busy !== null} onClick={() => approveAndActivate(v.vendorId)}>Approve &amp; activate</button>
                            <button className={styles.dangerButton} disabled={busy !== null} onClick={() => reject(v.vendorId)}>Reject</button>
                          </>
                        ) : (
                          <span className={styles.muted}>Onboarded</span>
                        )}
                        {v.workflowInstanceId !== null && (
                          <button type="button" className={styles.secondaryButton} onClick={() => setTrace(v)}>Trace</button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {vendors.length === 0 && <p className={styles.empty}>No vendors yet. Register one to begin onboarding.</p>}
        </div>
      </section>

      {trace && (
        <WorkflowTraceModal
          title={`Workflow trace — ${trace.legalName}`}
          historyUrl={`/api/vendors/${encodeURIComponent(trace.vendorId)}/workflow/history${queryString}`}
          onClose={() => setTrace(null)}
        />
      )}
    </section>
  );
}
