'use client';

import { useState } from 'react';
import styles from '../workflows/page.module.css';

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

const badge = (state: string): React.CSSProperties => {
  const map: Record<string, string> = { ACTIVE: '#0f766e', PENDING: '#b45309', SUSPENDED: '#94a3b8', REJECTED: '#b91c1c' };
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: '#fff', background: map[state] ?? '#64748b' };
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' };

export function VendorsClient({ initialVendors, queryString = '' }: { initialVendors: VendorRow[]; queryString?: string }) {
  const [vendors, setVendors] = useState<VendorRow[]>(initialVendors);
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wf, setWf] = useState<Record<string, WfState>>({});

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

  return (
    <section className={styles.panel} aria-labelledby="vendors-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Onboarding</p><h2 id="vendors-title">Vendors</h2></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={inp} placeholder="Legal name" value={legalName} onChange={(e) => setLegalName(e.target.value)} aria-label="Vendor legal name" />
          <input style={inp} placeholder="Tax ID (optional)" value={taxId} onChange={(e) => setTaxId(e.target.value)} aria-label="Vendor tax ID" />
          <button style={btn} onClick={register} disabled={busy !== null || legalName.trim() === ''}>{busy === 'register' ? 'Registering…' : 'Register vendor'}</button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Vendor</th><th>Status</th><th>Stage</th><th>Onboarding</th></tr></thead>
          <tbody>
            {vendors.map((v) => {
              const stage = v.stageKey;
              return (
                <tr key={v.vendorId}>
                  <td><strong>{v.legalName}</strong>{v.taxId ? <><br /><span className={styles.muted}>{v.taxId}</span></> : null}</td>
                  <td><span style={badge(v.status)}>{v.status}</span></td>
                  <td>{stage ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    {v.workflowInstanceId === null ? (
                      <button style={btn} disabled={busy !== null} onClick={() => start(v.vendorId)}>Start onboarding</button>
                    ) : stage === 'SUBMITTED' ? (
                      <span style={{ display: 'inline-flex', gap: 8 }}>
                        <button style={{ ...btn, background: '#334155' }} disabled={busy !== null} onClick={() => assignScreener(v.vendorId)}>Assign screener</button>
                        <button style={btn} disabled={busy !== null} onClick={() => advance(v.vendorId, 'SCREENING')}>Advance to screening</button>
                      </span>
                    ) : stage === 'SCREENING' ? (
                      <button style={btn} disabled={busy !== null} onClick={() => advance(v.vendorId, 'ACTIVE')}>Activate</button>
                    ) : (
                      <span className={styles.muted}>Onboarded</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {vendors.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No vendors yet. Register one to begin onboarding.</p>}
      </div>
    </section>
  );
}
