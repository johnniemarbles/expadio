'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../../workspace.module.css';

// Interest type + opportunity type combinations from the registry
const INTEREST_TYPE_OPTIONS = [
  { interestType: 'FRANCHISEE', opportunityType: 'SINGLE_UNIT', label: 'Franchise — Single Unit' },
  { interestType: 'FRANCHISEE', opportunityType: 'MULTI_UNIT', label: 'Franchise — Multi-Unit' },
  { interestType: 'FRANCHISEE', opportunityType: 'AREA_DEVELOPMENT', label: 'Franchise — Area Development' },
  { interestType: 'FRANCHISEE', opportunityType: 'CONVERSION', label: 'Franchise — Conversion' },
  { interestType: 'FRANCHISEE', opportunityType: 'RESALE', label: 'Franchise — Resale' },
  { interestType: 'MASTER_FRANCHISEE', opportunityType: null, label: 'Master Franchise' },
  { interestType: 'DISTRIBUTOR', opportunityType: 'EXCLUSIVE_DISTRIBUTOR', label: 'Distribution — Exclusive' },
  { interestType: 'DISTRIBUTOR', opportunityType: 'NON_EXCLUSIVE_DISTRIBUTOR', label: 'Distribution — Non-Exclusive' },
  { interestType: 'DISTRIBUTOR', opportunityType: 'MASTER_DISTRIBUTOR', label: 'Distribution — Master Distributor' },
  { interestType: 'DISTRIBUTOR', opportunityType: 'SUB_DISTRIBUTOR', label: 'Distribution — Sub-Distributor' },
  { interestType: 'AFFILIATE', opportunityType: null, label: 'Affiliate Partner' },
  { interestType: 'LICENSEE', opportunityType: null, label: 'License' },
  { interestType: 'AGENT', opportunityType: null, label: 'Sales Agent' },
] as const;

type Config = {
  configId: string;
  interestType: string;
  opportunityType: string | null;
  schemaKey: string;
  qualificationProfileKey: string;
  workflowBlueprintKey: string;
  evidenceProfileKey: string;
  defaultRoutingProfileKey: string;
  supportedPublicationModes: string[];
  reviewSlaBusinessDays: number;
  status: string;
  version: number;
  createdAt: string;
  publishedAt: string | null;
  submittedForReviewAt: string | null;
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'color-mix(in srgb,var(--theme-text-muted) 60%,transparent)',
  PENDING_PARENT_REVIEW: 'orange',
  ESCALATED: 'crimson',
  APPROVED: 'var(--theme-primary)',
  PUBLISHED: 'green',
  SUPERSEDED: 'var(--theme-text-muted)',
  EXPIRED_UNRESOLVED: 'crimson',
};

export default function CaptureConfigurationClient() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [selectedOption, setSelectedOption] = useState('FRANCHISEE:SINGLE_UNIT');
  const [reviewSla, setReviewSla] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/leads/management/configurations', { cache: 'no-store' });
      const body = await readJson(r);
      if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to load configurations.');
      setConfigs(Array.isArray(body.configurations) ? body.configurations as Config[] : []);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load configurations.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createConfig(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const [interestType, opportunityType] = selectedOption.includes(':')
        ? selectedOption.split(':')
        : [selectedOption, null];
      const r = await fetch('/api/leads/management/configurations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          interestType,
          opportunityType: opportunityType || null,
          reviewSlaBusinessDays: reviewSla,
        }),
      });
      const body = await readJson(r);
      if (!r.ok) {
        setNotice({ kind: 'error', text: typeof body.error === 'string' ? body.error : 'Creation failed.' });
      } else {
        setNotice({
          kind: 'success',
          text: `Configuration created (${String(body.configId ?? '')}). Status: DRAFT. Approval requirement: ${String(body.approvalRequirement ?? 'EXPLICIT_PARENT_APPROVAL')}.`,
        });
        await load();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setCreating(false);
    }
  }

  return <>
    {notice ? (
      <div className={styles.notice}>
        <strong>{notice.kind === 'success' ? 'Done' : 'Error'}</strong>
        <p>{notice.text}</p>
      </div>
    ) : null}

    {/* ── Create configuration ──────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Add interest type</h2></div>
      <div className={styles.panelBody}>
        <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', marginTop: 0 }}>
          Each configuration activates one commercial interest type (e.g. Franchise Unit, Affiliate, Agent). The platform resolves the schema, qualification profile, workflow blueprint, and evidence profile from the registry — these are governed keys and cannot be replaced with free-form values.
        </p>
        <form onSubmit={createConfig} style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Interest type
            <select
              value={selectedOption}
              onChange={(e) => setSelectedOption(e.target.value)}
              disabled={creating}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
            >
              {INTEREST_TYPE_OPTIONS.map((opt) => {
                const key = opt.opportunityType ? `${opt.interestType}:${opt.opportunityType}` : opt.interestType;
                return <option key={key} value={key}>{opt.label}</option>;
              })}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Review SLA (business days)
            <input
              type="number"
              min={1}
              max={30}
              value={reviewSla}
              onChange={(e) => setReviewSla(Number(e.target.value))}
              disabled={creating}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, width: 100 }}
            />
          </label>
          <button type="submit" disabled={creating} className={styles.button} style={{ width: 'fit-content' }}>
            {creating ? 'Creating…' : 'Create configuration'}
          </button>
        </form>
      </div>
    </section>

    {/* ── Configuration list ────────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Configurations</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={styles.pill}>{loading ? 'LOADING' : `${configs.length} TOTAL`}</span>
          <button className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
      </div>

      {!loading && configs.length === 0 ? (
        <div className={styles.empty}>No configurations yet. Add an interest type above to get started.</div>
      ) : null}

      {configs.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Interest type</th>
                <th>Schema key</th>
                <th>Qualification profile</th>
                <th>Evidence profile</th>
                <th>Status</th>
                <th>Review SLA</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((cfg) => (
                <tr key={cfg.configId}>
                  <td>
                    <strong>{cfg.interestType}</strong>
                    {cfg.opportunityType ? <><br /><small>{cfg.opportunityType}</small></> : null}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{cfg.schemaKey}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{cfg.qualificationProfileKey}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{cfg.evidenceProfileKey}</td>
                  <td>
                    <span className={styles.pill} style={{ background: 'color-mix(in srgb,' + (STATUS_COLORS[cfg.status] ?? 'var(--theme-text-muted)') + ' 15%,transparent)', color: STATUS_COLORS[cfg.status] ?? 'var(--theme-text-muted)' }}>
                      {cfg.status}
                    </span>
                    {cfg.submittedForReviewAt ? <><br /><small>Submitted {new Date(cfg.submittedForReviewAt).toLocaleDateString()}</small></> : null}
                    {cfg.publishedAt ? <><br /><small>Published {new Date(cfg.publishedAt).toLocaleDateString()}</small></> : null}
                  </td>
                  <td>{cfg.reviewSlaBusinessDays}d</td>
                  <td><small>{new Date(cfg.createdAt).toLocaleDateString()}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  </>;
}
