'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRIES, getStatesForCountry } from '../../../../lib/geo-data';
import styles from '../../workspace.module.css';

type Notice = { kind: 'success' | 'error'; text: string } | null;
type FieldErrors = Partial<Record<string, string>>;

type ContactCandidate = {
  contactId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  accountName: string | null;
  countryCode: string | null;
  city: string | null;
  createdAt: string;
};

type AccountOption = { accountId: string; name: string };

const INP: React.CSSProperties = { padding: '8px 10px', borderRadius: "var(--theme-radius-control)", border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const INP_ERR: React.CSSProperties = { ...INP, borderColor: 'crimson' };
const SEL: React.CSSProperties = { ...INP };
function inp(err?: string): React.CSSProperties { return err ? INP_ERR : INP; }

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

export default function CreateContactForm({ accounts }: { accounts: readonly AccountOption[] }) {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dialCode, setDialCode] = useState('+1');
  const [title, setTitle] = useState('');
  const [accountId, setAccountId] = useState('');

  // Geography
  const [countryCode, setCountryCode] = useState('');
  const [regionOrState, setRegionOrState] = useState('');
  const [city, setCity] = useState('');

  // Nominatim city suggestions
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const cityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search-first dedup
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [searchDismissed, setSearchDismissed] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // Search-first: fire on email or phone change
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!email && !phone) { setCandidates([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams();
        if (email) params.set('email', email);
        if (phone) params.set('phone', phone);
        const r = await fetch(`/api/crm/contacts/search?${params.toString()}`, { cache: 'no-store' });
        const body = await readJson(r);
        const list = Array.isArray(body.contacts) ? body.contacts as ContactCandidate[] : [];
        setCandidates(list);
        if (list.length > 0) setSearchDismissed(false);
      } catch { /* non-fatal */ }
      finally { setSearching(false); }
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, phone]);

  function handleCountryChange(code: string) {
    setCountryCode(code);
    setRegionOrState('');
    setCity('');
    if (!code) return;
    const country = COUNTRIES.find((c) => c.code === code);
    if (country) setDialCode(country.dialCode);
  }

  function handleCityChange(value: string) {
    setCity(value);
    if (cityTimer.current) clearTimeout(cityTimer.current);
    if (value.length < 3) { setCitySuggestions([]); return; }
    cityTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: value, format: 'json', limit: '5', addressdetails: '1' });
        if (countryCode) params.set('countrycodes', countryCode.toLowerCase());
        const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: { 'Accept-Language': 'en' },
        });
        const results = await r.json() as Array<{ display_name: string; address?: { city?: string; town?: string; village?: string; county?: string } }>;
        setCitySuggestions(results.slice(0, 5).map((res) => {
          const a = res.address ?? {};
          return a.city ?? a.town ?? a.village ?? a.county ?? res.display_name.split(',')[0] ?? '';
        }).filter(Boolean));
        setShowCitySuggestions(true);
      } catch { /* non-fatal */ }
    }, 500);
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!fullName.trim()) errs.fullName = 'Full name is required.';
    if (!email.trim() && !phone.trim()) errs.email = 'Email or phone is required.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter a valid email address.';
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    setNotice(null);

    const fullPhone = phone.trim() ? `${dialCode} ${phone.trim()}` : '';
    try {
      const r = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase() || null,
          phone: fullPhone || null,
          title: title.trim() || null,
          accountId: accountId || null,
          countryCode: countryCode || null,
          regionOrState: regionOrState || null,
          city: city || null,
        }),
      });
      const resp = await readJson(r);
      if (!r.ok) {
        const errField = typeof resp.field === 'string' ? resp.field : undefined;
        const errMsg = typeof resp.error === 'string' ? resp.error : 'Creation failed.';
        if (errField) setErrors({ [errField]: errMsg });
        setNotice({ kind: 'error', text: errMsg });
      } else {
        setNotice({ kind: 'success', text: `Contact "${fullName.trim()}" created.` });
        setFullName(''); setEmail(''); setPhone(''); setTitle(''); setAccountId('');
        setCountryCode(''); setRegionOrState(''); setCity(''); setCandidates([]);
        router.refresh();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const states = getStatesForCountry(countryCode);
  const showCandidates = candidates.length > 0 && !searchDismissed;
  const sectionHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--theme-text-muted)', marginBottom: 2 };
  const divider: React.CSSProperties = { borderTop: '1px solid var(--theme-border)', paddingTop: 16, marginTop: 4 };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 0 }}>
      {notice ? (
        <div className={styles.notice} style={{ marginBottom: 16 }}>
          <strong>{notice.kind === 'success' ? 'Done' : 'Error'}</strong>
          <p>{notice.text}</p>
        </div>
      ) : null}

      {/* Contact details */}
      <div style={{ display: 'grid', gap: 12, paddingBottom: 16 }}>
        <p style={sectionHead}>Contact details</p>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Full name *
          <input style={inp(errors.fullName)} value={fullName} onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Smith" disabled={submitting} />
          {errors.fullName ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.fullName}</small> : null}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Job title
            <input style={INP} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Operations Director" disabled={submitting} />
          </label>
          {accounts.length > 0 ? (
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Link to account
              <select style={SEL} value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={submitting}>
                <option value="">— No account —</option>
                {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Email *
          <input style={inp(errors.email)} type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" disabled={submitting} />
          {errors.email ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.email}</small> : null}
          {searching ? <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>Checking for existing records…</small> : null}
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Phone
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={dialCode} onChange={(e) => setDialCode(e.target.value)}
              style={{ ...SEL, width: 110, flexShrink: 0 }} disabled={submitting}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.dialCode}>{c.dialCode} {c.code}</option>)}
            </select>
            <input style={{ ...INP, flex: 1 }} type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="555 000 0000" disabled={submitting} />
          </div>
        </label>

        {/* Duplicate candidate panel */}
        {showCandidates ? (
          <div style={{ border: '1px solid orange', borderRadius: "var(--theme-radius-card)", padding: 12, background: 'color-mix(in srgb,orange 8%,transparent)' }}>
            <strong style={{ fontSize: 12 }}>⚠ Possible duplicate — {candidates.length} existing contact{candidates.length > 1 ? 's' : ''} found</strong>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {candidates.map((c) => (
                <div key={c.contactId} style={{ fontSize: 12 }}>
                  <strong>{c.fullName}</strong>
                  {c.email ? ` · ${c.email}` : ''}
                  {c.phone ? ` · ${c.phone}` : ''}
                  {c.accountName ? ` · ${c.accountName}` : ''}
                  {c.city ? ` · ${c.city}` : ''}
                  {c.countryCode ? ` (${c.countryCode})` : ''}
                  <span style={{ color: 'var(--theme-text-muted)' }}> · {new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setSearchDismissed(true)}
              style={{ marginTop: 10, fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--theme-border)', borderRadius: "var(--theme-radius-card)", padding: '4px 10px', color: 'var(--theme-text-primary)' }}>
              Create new record anyway
            </button>
          </div>
        ) : null}
      </div>

      {/* Location */}
      <div style={{ ...divider, display: 'grid', gap: 12, paddingBottom: 20 }}>
        <p style={sectionHead}>Location</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Country
            <select style={SEL} value={countryCode} onChange={(e) => handleCountryChange(e.target.value)} disabled={submitting}>
              <option value="">— Select country —</option>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            {states.length > 0 ? 'State / Province' : 'State / Region'}
            {states.length > 0 ? (
              <select style={SEL} value={regionOrState} onChange={(e) => setRegionOrState(e.target.value)} disabled={submitting}>
                <option value="">— Select —</option>
                {states.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <input style={INP} placeholder="State or region" value={regionOrState}
                onChange={(e) => setRegionOrState(e.target.value)} disabled={submitting} />
            )}
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, position: 'relative' }}>
          City
          <input style={INP} value={city} onChange={(e) => handleCityChange(e.target.value)}
            onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)}
            placeholder="City" disabled={submitting} />
          {showCitySuggestions && citySuggestions.length > 0 ? (
            <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, margin: 0, padding: 0, listStyle: 'none', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', borderRadius: "var(--theme-radius-card)", fontSize: 12 }}>
              {citySuggestions.map((s, i) => (
                <li key={i} onMouseDown={() => { setCity(s); setCitySuggestions([]); setShowCitySuggestions(false); }}
                  style={{ padding: '6px 10px', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--theme-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
        </label>
      </div>

      <button type="submit" disabled={submitting} className={styles.button} style={{ width: 'fit-content' }}>
        {submitting ? 'Creating…' : 'Create contact'}
      </button>
    </form>
  );
}
