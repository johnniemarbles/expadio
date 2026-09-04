'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRIES } from '../../../../lib/geo-data';
import styles from '../../workspace.module.css';

type Notice = { kind: 'success' | 'error'; text: string } | null;
type FieldErrors = Partial<Record<string, string>>;

type AccountCandidate = {
  accountId: string;
  name: string;
  domain: string | null;
  lifecycleStage: string;
  countryCode: string | null;
  city: string | null;
};

const INP: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const INP_ERR: React.CSSProperties = { ...INP, borderColor: 'crimson' };
const SEL: React.CSSProperties = { ...INP };
function inp(err?: string): React.CSSProperties { return err ? INP_ERR : INP; }

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

const LIFECYCLE_OPTIONS = [
  { value: 'PROSPECT', label: 'Prospect' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'OPPORTUNITY', label: 'Opportunity' },
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'CHURNED', label: 'Churned' },
];

export default function CreateAccountForm() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState('PROSPECT');
  const [countryCode, setCountryCode] = useState('');
  const [city, setCity] = useState('');

  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<AccountCandidate[]>([]);
  const [searchDismissed, setSearchDismissed] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // Search-first: fire on name or domain change
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!name.trim() && !domain.trim()) { setCandidates([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams();
        if (name.trim()) params.set('name', name.trim());
        if (domain.trim()) params.set('domain', domain.trim());
        const r = await fetch(`/api/crm/accounts/search?${params.toString()}`, { cache: 'no-store' });
        const body = await readJson(r);
        const list = Array.isArray(body.accounts) ? body.accounts as AccountCandidate[] : [];
        setCandidates(list);
        if (list.length > 0) setSearchDismissed(false);
      } catch { /* non-fatal */ }
      finally { setSearching(false); }
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, domain]);

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = 'Account name is required.';
    if (domain.trim() && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(domain.trim().toLowerCase())) {
      errs.domain = 'Enter a valid domain (e.g. acme.com).';
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    setNotice(null);

    try {
      const r = await fetch('/api/crm/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim() || null,
          industry: industry.trim() || null,
          lifecycleStage,
          countryCode: countryCode || null,
          city: city.trim() || null,
        }),
      });
      const resp = await readJson(r);
      if (!r.ok) {
        const errField = typeof resp.field === 'string' ? resp.field : undefined;
        const errMsg = typeof resp.error === 'string' ? resp.error : 'Creation failed.';
        if (errField) setErrors({ [errField]: errMsg });
        setNotice({ kind: 'error', text: errMsg });
      } else {
        setNotice({ kind: 'success', text: `Account "${name.trim()}" created.` });
        setName(''); setDomain(''); setIndustry(''); setLifecycleStage('PROSPECT');
        setCountryCode(''); setCity(''); setCandidates([]);
        router.refresh();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const showCandidates = candidates.length > 0 && !searchDismissed;
  const sectionHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--theme-text-muted)', marginBottom: 2 };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 0 }}>
      {notice ? (
        <div className={styles.notice} style={{ marginBottom: 16 }}>
          <strong>{notice.kind === 'success' ? 'Done' : 'Error'}</strong>
          <p>{notice.text}</p>
        </div>
      ) : null}

      {/* Account identity */}
      <div style={{ display: 'grid', gap: 12, paddingBottom: 16 }}>
        <p style={sectionHead}>Account identity</p>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Company / account name *
          <input style={inp(errors.name)} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corporation" disabled={submitting} />
          {errors.name ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.name}</small> : null}
          {searching ? <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>Checking for existing records…</small> : null}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Website domain
            <input style={inp(errors.domain)} value={domain} onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.com" disabled={submitting} />
            {errors.domain ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.domain}</small> : null}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Industry / sector
            <input style={INP} value={industry} onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Food & Beverage" disabled={submitting} />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Lifecycle stage
          <select style={SEL} value={lifecycleStage} onChange={(e) => setLifecycleStage(e.target.value)} disabled={submitting}>
            {LIFECYCLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        {/* Duplicate candidate panel */}
        {showCandidates ? (
          <div style={{ border: '1px solid orange', borderRadius: 8, padding: 12, background: 'color-mix(in srgb,orange 8%,transparent)' }}>
            <strong style={{ fontSize: 12 }}>⚠ Possible duplicate — {candidates.length} existing account{candidates.length > 1 ? 's' : ''} found</strong>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {candidates.map((c) => (
                <div key={c.accountId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, gap: 8 }}>
                  <span>
                    <strong>{c.name}</strong>
                    {c.domain ? ` · ${c.domain}` : ''}
                    {c.city ? ` · ${c.city}` : ''}
                    {c.countryCode ? ` · ${c.countryCode}` : ''}
                    <span style={{ color: 'var(--theme-text-muted)' }}> · {c.lifecycleStage}</span>
                  </span>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setSearchDismissed(true)}
              style={{ marginTop: 10, fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--theme-border)', borderRadius: 6, padding: '4px 10px', color: 'var(--theme-text-primary)' }}>
              Create new record anyway
            </button>
          </div>
        ) : null}
      </div>

      {/* Location */}
      <div style={{ borderTop: '1px solid var(--theme-border)', paddingTop: 16, display: 'grid', gap: 12, paddingBottom: 20 }}>
        <p style={sectionHead}>Location</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Country
            <select style={SEL} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} disabled={submitting}>
              <option value="">— Select country —</option>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            City
            <input style={INP} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" disabled={submitting} />
          </label>
        </div>
      </div>

      <button type="submit" disabled={submitting} className={styles.button} style={{ width: 'fit-content' }}>
        {submitting ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
