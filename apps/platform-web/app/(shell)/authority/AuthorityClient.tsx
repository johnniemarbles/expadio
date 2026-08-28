'use client';

import { useState } from 'react';
import styles from '../workflows/page.module.css';

/**
 * Approval-authority administration. A governing role grants a subject authority
 * on a dimension — most commonly a monetary approval ceiling — which the
 * Decision Fabric's authority gate then enforces when that subject records a
 * decision (e.g. approving an expense whose amount sets the required threshold).
 * Without this surface a governed decision that carries a monetary requirement
 * can never be cleared from the app.
 */

interface AuthorityGrant {
  dimensionKey: string;
  thresholdMinorUnits: number | null;
  currency: string | null;
  scopeType: 'TENANT' | 'ORGANIZATION';
  scopeEntityId: string | null;
  delegatedFromSubjectId: string | null;
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (typeof r.error === 'string') return r.error;
    if (typeof r.message === 'string') return r.message;
  }
  return fallback;
}

const ceiling = (g: AuthorityGrant): string => {
  if (g.thresholdMinorUnits === null) return 'unlimited';
  const cur = g.currency ?? 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(g.thresholdMinorUnits / 100);
  } catch {
    return `${(g.thresholdMinorUnits / 100).toFixed(2)} ${cur}`;
  }
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' };

export function AuthorityClient({ queryString = '' }: { queryString?: string }) {
  const [subjectId, setSubjectId] = useState('');
  const [dimensionKey, setDimensionKey] = useState('monetary.approval');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [scopeOrg, setScopeOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [lookupId, setLookupId] = useState('');
  const [grants, setGrants] = useState<AuthorityGrant[] | null>(null);

  async function grant() {
    if (subjectId.trim() === '') return;
    const major = amount.trim() === '' ? null : Number(amount);
    if (major !== null && !(major >= 0)) { setError('Amount must be a non-negative number.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/authority/grants${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: subjectId.trim(),
          dimensionKey: dimensionKey.trim() || 'monetary.approval',
          thresholdMinorUnits: major === null ? null : Math.round(major * 100),
          currency: currency.trim() || undefined,
          scopeType: scopeOrg.trim() !== '' ? 'ORGANIZATION' : 'TENANT',
          scopeEntityId: scopeOrg.trim() !== '' ? scopeOrg.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not record the grant.'));
      setNotice(`Granted ${dimensionKey.trim() || 'monetary.approval'} to ${subjectId.trim()}.`);
      setAmount('');
      if (lookupId.trim() === subjectId.trim()) await lookup(subjectId.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the grant.');
    } finally { setBusy(false); }
  }

  async function lookup(id: string) {
    const target = id.trim();
    if (target === '') return;
    setError(null);
    try {
      const res = await fetch(`/api/authority/grants${queryString ? queryString + '&' : '?'}subjectId=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not load grants.'));
      setGrants(Array.isArray(data.grants) ? data.grants : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load grants.');
      setGrants(null);
    }
  }

  return (
    <>
      <section className={styles.panel} aria-labelledby="grant-title">
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Governance</p><h2 id="grant-title">Grant approval authority</h2></div></div>
        <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <input style={inp} placeholder="Subject id (who gets the authority)" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject id" />
          <input style={inp} placeholder="Dimension" value={dimensionKey} onChange={(e) => setDimensionKey(e.target.value)} aria-label="Dimension key" />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Ceiling amount (blank = unlimited)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Ceiling amount" />
            <input style={{ ...inp, width: 90 }} placeholder="USD" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} aria-label="Currency" maxLength={3} />
          </div>
          <input style={inp} placeholder="Organization id (optional — scopes the grant)" value={scopeOrg} onChange={(e) => setScopeOrg(e.target.value)} aria-label="Organization scope id" />
          <div><button style={btn} onClick={grant} disabled={busy || subjectId.trim() === ''}>{busy ? 'Granting…' : 'Grant authority'}</button></div>
        </div>
        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
        {notice && <p style={{ color: '#0f766e', fontSize: 13, margin: '10px 0 0' }}>{notice}</p>}
      </section>

      <section className={styles.panel} aria-labelledby="lookup-title" style={{ marginTop: 16 }}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>Inspect</p><h2 id="lookup-title">A subject's grants</h2></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inp} placeholder="Subject id" value={lookupId} onChange={(e) => setLookupId(e.target.value)} aria-label="Lookup subject id" />
            <button style={btn} onClick={() => lookup(lookupId)} disabled={lookupId.trim() === ''}>Look up</button>
          </div>
        </div>
        {grants !== null && grants.length === 0 && <p className={styles.muted} style={{ padding: 8 }}>This subject holds no authority grants.</p>}
        {grants !== null && grants.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Dimension</th><th>Ceiling</th><th>Scope</th><th>Delegated from</th></tr></thead>
              <tbody>
                {grants.map((g, i) => (
                  <tr key={i}>
                    <td>{g.dimensionKey}</td>
                    <td>{ceiling(g)}</td>
                    <td>{g.scopeType === 'ORGANIZATION' ? `org ${g.scopeEntityId}` : 'tenant'}</td>
                    <td>{g.delegatedFromSubjectId ?? <span className={styles.muted}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
