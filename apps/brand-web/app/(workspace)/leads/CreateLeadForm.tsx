'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRIES, CURRENCIES, getStatesForCountry } from '../../../lib/geo-data';
import styles from '../workspace.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type Notice = { kind: 'success' | 'error'; text: string } | null;

type SearchLead = {
  leadId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  stage: string;
  interestType: string | null;
  city: string | null;
  countryCode: string | null;
  createdAt: string;
};

type FieldErrors = Partial<Record<string, string>>;

// ── Constants ─────────────────────────────────────────────────────────────────

const INTEREST_TYPE_OPTIONS = [
  { value: 'FRANCHISEE:SINGLE_UNIT', label: 'Franchise — Single Unit' },
  { value: 'FRANCHISEE:MULTI_UNIT', label: 'Franchise — Multi-Unit' },
  { value: 'FRANCHISEE:AREA_DEVELOPMENT', label: 'Franchise — Area Development' },
  { value: 'FRANCHISEE:CONVERSION', label: 'Franchise — Conversion' },
  { value: 'FRANCHISEE:RESALE', label: 'Franchise — Resale' },
  { value: 'MASTER_FRANCHISEE', label: 'Master Franchise' },
  { value: 'DISTRIBUTOR:EXCLUSIVE_DISTRIBUTOR', label: 'Distribution — Exclusive' },
  { value: 'DISTRIBUTOR:NON_EXCLUSIVE_DISTRIBUTOR', label: 'Distribution — Non-Exclusive' },
  { value: 'DISTRIBUTOR:MASTER_DISTRIBUTOR', label: 'Distribution — Master' },
  { value: 'DISTRIBUTOR:SUB_DISTRIBUTOR', label: 'Distribution — Sub-Distributor' },
  { value: 'AFFILIATE', label: 'Affiliate Partner' },
  { value: 'LICENSEE', label: 'License' },
  { value: 'AGENT', label: 'Sales Agent' },
] as const;

const FRANCHISE_ROLES = [
  { value: 'OWNER_OPERATOR', label: 'Owner-Operator' },
  { value: 'INVESTOR', label: 'Investor' },
  { value: 'OPERATING_PARTNER', label: 'Operating Partner' },
  { value: 'MULTI_UNIT_OPERATOR', label: 'Multi-Unit Operator' },
];

const TIMELINES = [
  { value: 'IMMEDIATE', label: 'Immediately' },
  { value: '3_MONTHS', label: 'Within 3 months' },
  { value: '6_MONTHS', label: 'Within 6 months' },
  { value: '12_MONTHS', label: 'Within 12 months' },
  { value: 'FLEXIBLE', label: 'Flexible / Not sure' },
];

const WAREHOUSE_SIZES = [
  { value: 'SMALL', label: 'Small (< 500 m²)' },
  { value: 'MEDIUM', label: 'Medium (500–2000 m²)' },
  { value: 'LARGE', label: 'Large (> 2000 m²)' },
];

const AFFILIATE_CHANNELS = [
  { value: 'SOCIAL_MEDIA', label: 'Social media' },
  { value: 'BLOG', label: 'Blog / content' },
  { value: 'EMAIL', label: 'Email list' },
  { value: 'INFLUENCER', label: 'Influencer' },
  { value: 'MARKETPLACE', label: 'Marketplace' },
  { value: 'OTHER', label: 'Other' },
];

const ROYALTY_MODELS = [
  { value: 'FIXED', label: 'Fixed fee' },
  { value: 'PERCENTAGE', label: 'Percentage of revenue' },
  { value: 'HYBRID', label: 'Hybrid' },
];

const COMMISSION_MODELS = [
  { value: 'PERCENTAGE', label: 'Percentage of sales' },
  { value: 'FIXED', label: 'Fixed fee per sale' },
  { value: 'HYBRID', label: 'Hybrid' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

function parseInterestKey(key: string): { interestType: string; opportunityType: string | null } {
  const [a, b] = key.split(':');
  return { interestType: a ?? key, opportunityType: b ?? null };
}

function fieldSet(
  value: unknown,
  setter: (v: string) => void,
): (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void {
  void value;
  return (e) => setter(e.target.value);
}

// ── Sub-components: interest-type-specific fields ─────────────────────────────

function FormRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const inp = { padding: '8px 10px', borderRadius: "var(--theme-radius-control)", border: `1px solid ${error ? 'crimson' : 'var(--theme-border)'}`, background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, width: '100%', boxSizing: 'border-box' as const };
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
      {label}
      {/* pass inp style via context pattern — children receive no style here; they set it themselves */}
      <div style={{ display: 'contents' }}>{children}</div>
      {error ? <small style={{ color: 'crimson', fontWeight: 400 }}>{error}</small> : null}
    </label>
  );
}

const INP: React.CSSProperties = { padding: '8px 10px', borderRadius: "var(--theme-radius-control)", border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const INP_ERR: React.CSSProperties = { ...INP, borderColor: 'crimson' };
const SEL: React.CSSProperties = { ...INP };

function inp(err?: string): React.CSSProperties { return err ? INP_ERR : INP; }

// ── Franchise / Master Franchise fields ──────────────────────────────────────

function FranchiseeFields({ payload, onChange, currency, errors }: {
  payload: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  currency: string;
  errors: FieldErrors;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Investment budget ({currency})
          <input style={inp(errors.investmentBudget)} type="number" min="0" placeholder="e.g. 200000"
            value={String(payload.investmentBudget ?? '')}
            onChange={(e) => onChange('investmentBudget', e.target.value ? Number(e.target.value) : null)} />
          <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>Total budget including fees & setup</small>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Liquid capital available ({currency})
          <input style={INP} type="number" min="0" placeholder="e.g. 80000"
            value={String(payload.liquidCapital ?? '')}
            onChange={(e) => onChange('liquidCapital', e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Preferred opening timeline
          <select style={SEL} value={String(payload.timeline ?? '')} onChange={(e) => onChange('timeline', e.target.value || null)}>
            <option value="">— Select —</option>
            {TIMELINES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Intended role
          <select style={SEL} value={String(payload.intendedRole ?? '')} onChange={(e) => onChange('intendedRole', e.target.value || null)}>
            <option value="">— Select —</option>
            {FRANCHISE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Units interested in
          <input style={INP} type="number" min="1" placeholder="e.g. 3"
            value={String(payload.unitsDesired ?? '')}
            onChange={(e) => onChange('unitsDesired', e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Franchise experience (yrs)
          <input style={INP} type="number" min="0"
            value={String(payload.franchiseYears ?? '')}
            onChange={(e) => onChange('franchiseYears', e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 18 }}>
          <input type="checkbox" checked={Boolean(payload.financingRequired)}
            onChange={(e) => onChange('financingRequired', e.target.checked)} />
          Financing required
        </label>
      </div>
    </div>
  );
}

function MasterFranchiseeFields({ payload, onChange, currency }: {
  payload: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  currency: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Territory investment budget ({currency})
          <input style={INP} type="number" min="0" placeholder="e.g. 2000000"
            value={String(payload.territoryInvestment ?? '')}
            onChange={(e) => onChange('territoryInvestment', e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Sub-franchise target (units)
          <input style={INP} type="number" min="1" placeholder="e.g. 50"
            value={String(payload.subFranchiseTarget ?? '')}
            onChange={(e) => onChange('subFranchiseTarget', e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
        Territory sought <span style={{ fontWeight: 400 }}>(country, region, or state)</span>
        <input style={INP} placeholder="e.g. Southeast Asia, Germany, Texas"
          value={String(payload.territorySought ?? '')}
          onChange={(e) => onChange('territorySought', e.target.value || null)} />
      </label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          ['hasNetworkMgmt', 'Network management experience'],
          ['hasFieldSupport', 'Field support capability'],
          ['hasTraining', 'Training infrastructure'],
        ].map(([key, label]) => (
          <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <input type="checkbox" checked={Boolean(payload[key])}
              onChange={(e) => onChange(key, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function DistributorFields({ payload, onChange, currency }: {
  payload: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  currency: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Warehouse capacity
          <select style={SEL} value={String(payload.warehouseCapacity ?? '')} onChange={(e) => onChange('warehouseCapacity', e.target.value || null)}>
            <option value="">— Select —</option>
            {WAREHOUSE_SIZES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Sales team size
          <input style={INP} type="number" min="0" placeholder="e.g. 10"
            value={String(payload.salesTeamSize ?? '')}
            onChange={(e) => onChange('salesTeamSize', e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Est. initial order ({currency})
          <input style={INP} type="number" min="0"
            value={String(payload.initialOrder ?? '')}
            onChange={(e) => onChange('initialOrder', e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
        Product categories of interest
        <input style={INP} placeholder="e.g. FMCG, Food & Beverage, Electronics"
          value={String(payload.productCategories ?? '')}
          onChange={(e) => onChange('productCategories', e.target.value || null)} />
      </label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          ['hasDeliveryFleet', 'Own delivery fleet'],
          ['hasImport', 'Import capability'],
          ['has3PL', 'Third-party logistics'],
        ].map(([key, label]) => (
          <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <input type="checkbox" checked={Boolean(payload[key])}
              onChange={(e) => onChange(key, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function AffiliateFields({ payload, onChange }: { payload: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
        Website / platform URL
        <input style={INP} type="url" placeholder="https://yoursite.com"
          value={String(payload.websiteUrl ?? '')}
          onChange={(e) => onChange('websiteUrl', e.target.value || null)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Primary channel
          <select style={SEL} value={String(payload.primaryChannel ?? '')} onChange={(e) => onChange('primaryChannel', e.target.value || null)}>
            <option value="">— Select —</option>
            {AFFILIATE_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Audience size
          <input style={INP} type="number" min="0" placeholder="e.g. 50000"
            value={String(payload.audienceSize ?? '')}
            onChange={(e) => onChange('audienceSize', e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Monthly traffic
          <input style={INP} type="number" min="0"
            value={String(payload.monthlyTraffic ?? '')}
            onChange={(e) => onChange('monthlyTraffic', e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>
    </div>
  );
}

function LicenseeFields({ payload, onChange }: { payload: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
        License usage intent *
        <textarea style={{ ...INP, minHeight: 72 }} placeholder="Describe how you intend to use the license..."
          value={String(payload.licenseIntent ?? '')}
          onChange={(e) => onChange('licenseIntent', e.target.value || null)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Intended territory
          <input style={INP} placeholder="e.g. ANZ, Western Europe"
            value={String(payload.intendedTerritory ?? '')}
            onChange={(e) => onChange('intendedTerritory', e.target.value || null)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Royalty model preference
          <select style={SEL} value={String(payload.royaltyModel ?? '')} onChange={(e) => onChange('royaltyModel', e.target.value || null)}>
            <option value="">— Select —</option>
            {ROYALTY_MODELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function AgentFields({ payload, onChange }: { payload: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Target sector / industry
          <input style={INP} placeholder="e.g. Retail, F&B, Healthcare"
            value={String(payload.targetSector ?? '')}
            onChange={(e) => onChange('targetSector', e.target.value || null)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Commission model preference
          <select style={SEL} value={String(payload.commissionModel ?? '')} onChange={(e) => onChange('commissionModel', e.target.value || null)}>
            <option value="">— Select —</option>
            {COMMISSION_MODELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
        Customer network description
        <textarea style={{ ...INP, minHeight: 72 }} placeholder="Describe your existing customer base and network..."
          value={String(payload.networkDescription ?? '')}
          onChange={(e) => onChange('networkDescription', e.target.value || null)} />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        <input type="checkbox" checked={Boolean(payload.exclusivitySought)}
          onChange={(e) => onChange('exclusivitySought', e.target.checked)} />
        Seeking exclusivity
      </label>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CreateLeadForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();

  // Interest type
  const [interestKey, setInterestKey] = useState('');

  // Contact
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dialCode, setDialCode] = useState('+1');

  // Search / dedup
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<SearchLead[]>([]);
  const [searchDismissed, setSearchDismissed] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Geography
  const [countryCode, setCountryCode] = useState('');
  const [regionOrState, setRegionOrState] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Nominatim suggestions for city
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const cityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Interest-type-specific payload
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const setField = useCallback((k: string, v: unknown) => setPayload((p) => ({ ...p, [k]: v })), []);

  // Notes / financial
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [amountStr, setAmountStr] = useState('');

  // Form state
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // ── Country change: update dial code, currency, clear state ──────────────

  function handleCountryChange(code: string) {
    setCountryCode(code);
    setRegionOrState('');
    setCity('');
    if (!code) return;
    const country = COUNTRIES.find((c) => c.code === code);
    if (country) {
      setDialCode(country.dialCode);
      setCurrency(country.defaultCurrency);
    }
  }

  // ── Dedup search: fires 400ms after email/phone stabilises ───────────────

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!email && !phone) { setCandidates([]); return; }

    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams();
        if (email) params.set('email', email);
        if (phone) params.set('phone', phone);
        const r = await fetch(`/api/leads/search?${params.toString()}`, { cache: 'no-store' });
        const body = await readJson(r);
        const list = Array.isArray(body.leads) ? body.leads as SearchLead[] : [];
        setCandidates(list);
        if (list.length > 0) setSearchDismissed(false);
      } catch { /* non-fatal */ }
      finally { setSearching(false); }
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, phone]);

  // ── Nominatim city suggestions ────────────────────────────────────────────

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
        const results = await r.json() as Array<{ display_name: string; address?: { city?: string; town?: string; village?: string; county?: string; state?: string; postcode?: string } }>;
        setCitySuggestions(results.slice(0, 5).map((res) => {
          const a = res.address ?? {};
          return a.city ?? a.town ?? a.village ?? a.county ?? res.display_name.split(',')[0] ?? '';
        }).filter(Boolean));
        setShowCitySuggestions(true);
      } catch { /* non-fatal */ }
    }, 500);
  }

  function selectCitySuggestion(suggestion: string) {
    setCity(suggestion);
    setCitySuggestions([]);
    setShowCitySuggestions(false);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!firstName.trim()) errs.firstName = 'First name is required.';
    if (!lastName.trim()) errs.lastName = 'Last name is required.';
    if (!email.trim() && !phone.trim()) errs.email = 'Email or phone is required.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter a valid email address.';
    if (!interestKey) errs.interestType = 'Select an interest type.';
    if (!notes.trim()) errs.notes = 'Add a brief note about this lead.';
    if (amountStr && (isNaN(Number(amountStr)) || Number(amountStr) < 0)) errs.amount = 'Enter a valid positive number.';
    return errs;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    setNotice(null);

    const { interestType, opportunityType } = parseInterestKey(interestKey);
    const fullPhone = phone.trim() ? `${dialCode} ${phone.trim()}` : '';
    const body = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      contactEmail: email.trim().toLowerCase() || null,
      contactPhone: fullPhone || null,
      enquiryInterestType: interestType,
      enquiryOpportunityType: opportunityType,
      countryCode: countryCode || null,
      regionOrState: regionOrState || null,
      city: city || null,
      postalCode: postalCode || null,
      title: notes.trim() || `${firstName} ${lastName}`.trim(),
      currency,
      amountMinorUnits: amountStr ? Math.round(Number(amountStr) * 100) : null,
      enquiryPayload: Object.keys(payload).length > 0 ? payload : null,
    };

    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resp = await readJson(r);
      if (!r.ok) {
        const errField = typeof resp.field === 'string' ? resp.field : undefined;
        const errMsg = typeof resp.error === 'string' ? resp.error : 'Creation failed. Please try again.';
        if (errField) setErrors({ [errField]: errMsg });
        setNotice({ kind: 'error', text: errMsg });
      } else {
        setNotice({ kind: 'success', text: `Lead created for ${firstName} ${lastName}.` });
        // Reset form
        setInterestKey(''); setFirstName(''); setLastName(''); setEmail(''); setPhone('');
        setCountryCode(''); setRegionOrState(''); setCity(''); setPostalCode('');
        setPayload({}); setNotes(''); setAmountStr(''); setCandidates([]);
        onCreated?.();
        router.refresh();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const states = getStatesForCountry(countryCode);
  const { interestType } = parseInterestKey(interestKey);
  const isFranchisee = interestType === 'FRANCHISEE';
  const isMasterFranchisee = interestType === 'MASTER_FRANCHISEE';
  const isDistributor = interestType === 'DISTRIBUTOR';
  const isAffiliate = interestType === 'AFFILIATE';
  const isLicensee = interestType === 'LICENSEE';
  const isAgent = interestType === 'AGENT';
  const showCandidates = candidates.length > 0 && !searchDismissed;

  const sectionHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--theme-text-muted)', marginBottom: 2, marginTop: 4 };
  const divider: React.CSSProperties = { borderTop: '1px solid var(--theme-border)', paddingTop: 16, marginTop: 4 };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 0 }}>
      {notice ? (
        <div className={styles.notice} style={{ marginBottom: 16 }}>
          <strong>{notice.kind === 'success' ? 'Done' : 'Error'}</strong>
          <p>{notice.text}</p>
        </div>
      ) : null}

      {/* ── 1. Interest type ──────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, paddingBottom: 16 }}>
        <p style={sectionHead}>Interest type</p>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          What are they interested in? *
          <select
            value={interestKey}
            onChange={(e) => { setInterestKey(e.target.value); setPayload({}); }}
            style={errors.interestType ? { ...SEL, borderColor: 'crimson' } : SEL}
            disabled={submitting}
          >
            <option value="">— Select interest type —</option>
            {INTEREST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.interestType ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.interestType}</small> : null}
        </label>
      </div>

      {/* ── 2. Contact details ────────────────────────────────────────────── */}
      <div style={{ ...divider, display: 'grid', gap: 12, paddingBottom: 16 }}>
        <p style={sectionHead}>Contact details</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            First name *
            <input style={inp(errors.firstName)} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Given name" disabled={submitting} />
            {errors.firstName ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.firstName}</small> : null}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Last name *
            <input style={inp(errors.lastName)} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Family name" disabled={submitting} />
            {errors.lastName ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.lastName}</small> : null}
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Email *
          <input style={inp(errors.email)} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" disabled={submitting} />
          {errors.email ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.email}</small> : null}
          {searching ? <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>Checking for existing records…</small> : null}
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Phone
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={dialCode} onChange={(e) => setDialCode(e.target.value)} style={{ ...SEL, width: 110, flexShrink: 0 }} disabled={submitting}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.dialCode}>{c.dialCode} {c.code}</option>
              ))}
            </select>
            <input style={{ ...INP, flex: 1 }} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555 000 0000" disabled={submitting} />
          </div>
        </label>

        {/* Duplicate candidate panel */}
        {showCandidates ? (
          <div style={{ border: '1px solid orange', borderRadius: "var(--theme-radius-card)", padding: 12, background: 'color-mix(in srgb,orange 8%,transparent)' }}>
            <strong style={{ fontSize: 12 }}>⚠ Possible duplicate — {candidates.length} existing record{candidates.length > 1 ? 's' : ''} found</strong>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {candidates.map((c) => (
                <div key={c.leadId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, gap: 8 }}>
                  <span>
                    <strong>{c.displayName}</strong>
                    {c.email ? ` · ${c.email}` : ''}
                    {c.phone ? ` · ${c.phone}` : ''}
                    {c.interestType ? ` · ${c.interestType}` : ''}
                    {c.city ? ` · ${c.city}` : ''}
                    <span style={{ color: 'var(--theme-text-muted)' }}> · {c.stage} · {new Date(c.createdAt).toLocaleDateString()}</span>
                  </span>
                  <a href={`/leads/${c.leadId}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>View lead →</a>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setSearchDismissed(true)} style={{ marginTop: 10, fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--theme-border)', borderRadius: "var(--theme-radius-card)", padding: '4px 10px', color: 'var(--theme-text-primary)' }}>
              Create new record anyway
            </button>
          </div>
        ) : null}
      </div>

      {/* ── 3. Location ───────────────────────────────────────────────────── */}
      <div style={{ ...divider, display: 'grid', gap: 12, paddingBottom: 16 }}>
        <p style={sectionHead}>Location</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Country
            <select value={countryCode} onChange={(e) => handleCountryChange(e.target.value)} style={SEL} disabled={submitting}>
              <option value="">— Select country —</option>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            {states.length > 0 ? 'State / Province' : 'State / Region'}
            {states.length > 0 ? (
              <select value={regionOrState} onChange={(e) => setRegionOrState(e.target.value)} style={SEL} disabled={submitting}>
                <option value="">— Select —</option>
                {states.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <input style={INP} placeholder="State or region" value={regionOrState} onChange={(e) => setRegionOrState(e.target.value)} disabled={submitting} />
            )}
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, position: 'relative' }}>
            City
            <input style={INP} value={city} onChange={(e) => handleCityChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)}
              placeholder="City" disabled={submitting} />
            {showCitySuggestions && citySuggestions.length > 0 ? (
              <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, margin: 0, padding: 0, listStyle: 'none', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', borderRadius: "var(--theme-radius-card)", fontSize: 12 }}>
                {citySuggestions.map((s, i) => (
                  <li key={i} onMouseDown={() => selectCitySuggestion(s)}
                    style={{ padding: '6px 10px', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--theme-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {s}
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Postal / ZIP code
            <input style={INP} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal code" disabled={submitting} />
          </label>
        </div>
      </div>

      {/* ── 4. Interest-type-specific fields ──────────────────────────────── */}
      {interestKey ? (
        <div style={{ ...divider, display: 'grid', gap: 12, paddingBottom: 16 }}>
          <p style={sectionHead}>
            {INTEREST_TYPE_OPTIONS.find((o) => o.value === interestKey)?.label ?? 'Interest details'}
          </p>
          {(isFranchisee) && <FranchiseeFields payload={payload} onChange={setField} currency={currency} errors={errors} />}
          {isMasterFranchisee && <MasterFranchiseeFields payload={payload} onChange={setField} currency={currency} />}
          {isDistributor && <DistributorFields payload={payload} onChange={setField} currency={currency} />}
          {isAffiliate && <AffiliateFields payload={payload} onChange={setField} />}
          {isLicensee && <LicenseeFields payload={payload} onChange={setField} />}
          {isAgent && <AgentFields payload={payload} onChange={setField} />}
        </div>
      ) : null}

      {/* ── 5. Notes and financial ────────────────────────────────────────── */}
      <div style={{ ...divider, display: 'grid', gap: 12, paddingBottom: 20 }}>
        <p style={sectionHead}>Notes & value</p>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
          Notes / context *
          <textarea
            style={{ ...inp(errors.notes), minHeight: 72 }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="How did this lead come in? Any context for the team."
            disabled={submitting}
          />
          {errors.notes ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.notes}</small> : null}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Estimated deal value
            <input style={inp(errors.amount)} type="number" min="0" step="0.01"
              placeholder="e.g. 250000"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              disabled={submitting} />
            {errors.amount ? <small style={{ color: 'crimson', fontWeight: 400 }}>{errors.amount}</small> : null}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ ...SEL, width: 140 }} disabled={submitting}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <button type="submit" disabled={submitting} className={styles.button} style={{ width: 'fit-content' }}>
        {submitting ? 'Creating…' : 'Create lead'}
      </button>
    </form>
  );
}
