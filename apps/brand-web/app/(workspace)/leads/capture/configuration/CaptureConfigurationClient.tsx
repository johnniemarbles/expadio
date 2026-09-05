'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../../workspace.module.css';

const OFFERINGS = [
  { key: 'FRANCHISEE:SINGLE_UNIT', group: 'Franchise', label: 'Single unit', desc: 'One franchise location', slug: 'su' },
  { key: 'FRANCHISEE:MULTI_UNIT', group: 'Franchise', label: 'Multi-unit', desc: 'Multiple locations, one investor', slug: 'mu' },
  { key: 'FRANCHISEE:AREA_DEVELOPMENT', group: 'Franchise', label: 'Area development', desc: 'Exclusive territory rights', slug: 'ad' },
  { key: 'FRANCHISEE:CONVERSION', group: 'Franchise', label: 'Conversion', desc: 'Convert an existing business', slug: 'cv' },
  { key: 'FRANCHISEE:RESALE', group: 'Franchise', label: 'Resale', desc: 'Buy an existing franchise unit', slug: 'rs' },
  { key: 'MASTER_FRANCHISEE', group: 'Franchise', label: 'Master franchise', desc: 'Sub-license rights across a region', slug: 'mf' },
  { key: 'DISTRIBUTOR:EXCLUSIVE_DISTRIBUTOR', group: 'Distribution', label: 'Exclusive', desc: 'Sole rights in a territory', slug: 'ed' },
  { key: 'DISTRIBUTOR:NON_EXCLUSIVE_DISTRIBUTOR', group: 'Distribution', label: 'Non-exclusive', desc: 'Shared territory rights', slug: 'nd' },
  { key: 'DISTRIBUTOR:MASTER_DISTRIBUTOR', group: 'Distribution', label: 'Master distributor', desc: 'Manage regional sub-distributors', slug: 'md' },
  { key: 'DISTRIBUTOR:SUB_DISTRIBUTOR', group: 'Distribution', label: 'Sub-distributor', desc: 'Distribute under a master', slug: 'sd' },
  { key: 'AFFILIATE', group: 'Partner', label: 'Affiliate', desc: 'Commission-based referrals', slug: 'af' },
  { key: 'LICENSEE', group: 'Partner', label: 'License', desc: 'Use intellectual property', slug: 'lc' },
  { key: 'AGENT', group: 'Partner', label: 'Sales agent', desc: 'Represent the brand', slug: 'ag' },
] as const;

const GROUPS = ['Franchise', 'Distribution', 'Partner'] as const;

function parseKey(key: string): { interestType: string; opportunityType: string | null } {
  const [a, b] = key.split(':');
  return { interestType: a ?? key, opportunityType: b ?? null };
}

type ActiveForm = { key: string; configId: string; formUrl: string | null };
type Notice = { kind: 'success' | 'error'; text: string } | null;
type DraftMap = Map<string, string>; // offering key → configId

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export default function CaptureConfigurationClient({
  initialDomain,
  brandSlug,
}: {
  initialDomain?: string | null;
  brandSlug?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [activeForms, setActiveForms] = useState<ActiveForm[]>([]);
  const [draftConfigs, setDraftConfigs] = useState<DraftMap>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [domain, setDomain] = useState(initialDomain ?? '');
  const [activating, setActivating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, pubRes] = await Promise.all([
        fetch('/api/leads/management/configurations', { cache: 'no-store' }),
        fetch('/api/leads/publications', { cache: 'no-store' }),
      ]);
      const cfgBody = await readJson(cfgRes);
      const pubBody = await readJson(pubRes);

      const configs = Array.isArray(cfgBody.configurations)
        ? (cfgBody.configurations as Array<Record<string, unknown>>)
        : [];
      const pubs = Array.isArray(pubBody.publications)
        ? (pubBody.publications as Array<Record<string, unknown>>)
        : [];

      function configKey(c: Record<string, unknown>): string {
        const interestType = String(c.interestType ?? '');
        const opportunityType = typeof c.opportunityType === 'string' ? c.opportunityType : null;
        return opportunityType ? `${interestType}:${opportunityType}` : interestType;
      }

      const forms: ActiveForm[] = configs
        .filter((c) => String(c.status ?? '') === 'PUBLISHED')
        .map((c) => {
          const key = configKey(c);
          const configId = String(c.configId ?? '');
          const pub = pubs.find(
            (p) => p.captureConfigId === configId && p.publicationMode === 'HOSTED_FORM',
          );
          return {
            key,
            configId,
            formUrl: typeof pub?.hostedFormUrl === 'string' ? pub.hostedFormUrl : null,
          };
        });

      // Track DRAFT configs separately so activate() can resume them via the publish endpoint.
      const drafts: DraftMap = new Map();
      configs
        .filter((c) => String(c.status ?? '') === 'DRAFT')
        .forEach((c) => drafts.set(configKey(c), String(c.configId ?? '')));

      setActiveForms(forms);
      setDraftConfigs(drafts);
      setSelected(new Set(forms.map((f) => f.key)));

      const existingDomain = pubs.find((p) => typeof p.brandDomain === 'string')?.brandDomain;
      const fallback = typeof existingDomain === 'string' && existingDomain ? existingDomain : (initialDomain ?? '');
      setDomain((prev) => prev || fallback);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); } catch { /* non-fatal */ }
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
  }

  async function activate() {
    if (activating) return;
    setActivating(true);
    setNotice(null);

    const activeKeys = new Set(activeForms.map((f) => f.key));
    const toAdd = [...selected].filter((k) => !activeKeys.has(k));

    if (toAdd.length === 0) {
      setNotice({ kind: 'success', text: 'Everything is already up to date.' });
      setActivating(false);
      return;
    }

    const cleanDomain = domain.trim().replace(/^https?:\/\//, '');
    // Fall back to the platform slug domain so platform-hosted brands get a publication.
    const effectiveDomain = cleanDomain || (brandSlug ? `${brandSlug}.expadio.com` : '');
    const totalAfter = activeForms.length + toAdd.length;

    try {
      let added = 0;
      for (const key of toAdd) {
        const opt = OFFERINGS.find((o) => o.key === key);
        const { interestType, opportunityType } = parseKey(key);

        // Create config (or detect existing DRAFT for resume path).
        const cfgRes = await fetch('/api/leads/management/configurations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ interestType, opportunityType, reviewSlaBusinessDays: 5 }),
        });
        const cfgBody = await readJson(cfgRes);
        if (!cfgRes.ok && cfgRes.status !== 409) {
          throw new Error(
            typeof cfgBody.error === 'string' ? cfgBody.error : `Could not activate ${opt?.label ?? key}.`,
          );
        }

        let configId: string;
        if (cfgRes.status === 409) {
          // Resume an existing DRAFT config instead of skipping it.
          const draftId = draftConfigs.get(key);
          if (!draftId) { added++; continue; }
          configId = draftId;
        } else {
          configId = String(cfgBody.configId ?? '');
        }

        // Publish config
        const pubCfgRes = await fetch(
          `/api/leads/management/configurations/${configId}/publish`,
          { method: 'POST' },
        );
        if (!pubCfgRes.ok) {
          const e = await readJson(pubCfgRes);
          throw new Error(
            typeof e.error === 'string' ? e.error : `Could not publish config for ${opt?.label ?? key}.`,
          );
        }

        // Create hosted-form publication.
        if (effectiveDomain && opt) {
          const slug = totalAfter > 1 ? `/enquire-${opt.slug}` : '/enquire';
          const pubRes = await fetch('/api/leads/publications', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              captureConfigId: configId,
              publicationMode: 'HOSTED_FORM',
              captureSourceLabel: `Website — ${opt.label}`,
              publicationSlug: slug,
              brandDomain: effectiveDomain,
            }),
          });
          if (!pubRes.ok) {
            const pubErr = await readJson(pubRes);
            console.warn(`Publication creation failed for ${opt.label}:`, pubErr.error ?? pubRes.status);
          }
        }

        added++;
      }

      const parts = [`${added} offering${added !== 1 ? 's' : ''} activated.`];
      if (!effectiveDomain) parts.push('Enter your form domain above to get shareable links.');
      setNotice({ kind: 'success', text: parts.join(' ') });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Activation failed. Please try again.' });
    } finally {
      setActivating(false);
    }
  }

  const activeKeys = new Set(activeForms.map((f) => f.key));
  const newCount = [...selected].filter((k) => !activeKeys.has(k)).length;

  const chipBase: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 12px', borderRadius: "var(--theme-radius-card)", cursor: 'pointer',
    transition: 'border-color 0.1s, background 0.1s',
  };

  return <>
    {notice ? (
      <div className={styles.notice}>
        <strong>{notice.kind === 'success' ? 'Done' : 'Error'}</strong>
        <p>{notice.text}</p>
      </div>
    ) : null}

    {/* ── What you offer ─────────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>What can people enquire about?</h2></div>
      <div className={styles.panelBody}>
        <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', marginTop: 0, marginBottom: 20 }}>
          Tick the types of opportunity you offer. A ready-to-share form is created for each one automatically.
        </p>

        {loading ? <p style={{ fontSize: 13, color: 'var(--theme-text-muted)' }}>Loading…</p> : (
          <>
            {GROUPS.map((group) => (
              <div key={group} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--theme-text-muted)', margin: '0 0 8px' }}>
                  {group}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {OFFERINGS.filter((o) => o.group === group).map((opt) => {
                    const isActive = activeKeys.has(opt.key);
                    const isSelected = selected.has(opt.key);
                    return (
                      <label
                        key={opt.key}
                        style={{
                          ...chipBase,
                          border: `1px solid ${isSelected ? 'var(--theme-primary)' : 'var(--theme-border)'}`,
                          background: isSelected
                            ? 'color-mix(in srgb,var(--theme-primary) 8%,transparent)'
                            : 'var(--theme-surface)',
                          opacity: isActive ? 0.85 : 1,
                          cursor: isActive ? 'default' : 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isActive}
                          onChange={() => { if (!isActive) toggle(opt.key); }}
                          style={{ marginTop: 3, flexShrink: 0 }}
                        />
                        <span>
                          <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {opt.label}
                            {isActive ? (
                              <span style={{ fontSize: 9, fontWeight: 800, color: 'green', letterSpacing: '0.04em' }}>
                                ACTIVE
                              </span>
                            ) : null}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--theme-text-muted)', display: 'block', marginTop: 2 }}>
                            {opt.desc}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Domain field */}
            <div style={{ borderTop: '1px solid var(--theme-border)', paddingTop: 16, marginTop: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 4, maxWidth: 400 }}>
                Your form domain{' '}
                <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)' }}>(optional — for shareable links)</span>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="apply.yourbrand.com"
                  disabled={activating}
                  style={{
                    padding: '8px 10px', borderRadius: "var(--theme-radius-card)",
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                    color: 'var(--theme-text-primary)', fontSize: 13,
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                className={styles.button}
                onClick={() => void activate()}
                disabled={activating || newCount === 0}
                style={{ width: 'fit-content' }}
              >
                {activating
                  ? 'Activating…'
                  : newCount > 0
                    ? `Activate ${newCount} offering${newCount !== 1 ? 's' : ''}`
                    : 'Up to date'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>

    {/* ── Your forms ─────────────────────────────────────────────────── */}
    {activeForms.length > 0 ? (
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Your forms</h2>
          <span className={styles.pill}>{activeForms.length}</span>
        </div>
        <div style={{ display: 'grid', gap: 8, padding: '0 16px 16px' }}>
          {activeForms.map((form) => {
            const opt = OFFERINGS.find((o) => o.key === form.key);
            return (
              <div
                key={form.configId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: "var(--theme-radius-card)",
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {opt ? `${opt.group} — ${opt.label}` : form.key}
                  </div>
                  {form.formUrl ? (
                    <code style={{ fontSize: 11, color: 'var(--theme-text-muted)', wordBreak: 'break-all' }}>
                      {form.formUrl}
                    </code>
                  ) : (
                    <small style={{ color: 'var(--theme-text-muted)' }}>
                      Enter your domain above to get a shareable link
                    </small>
                  )}
                </div>
                {form.formUrl ? (
                  <button
                    onClick={() => void copyLink(form.formUrl!)}
                    className={styles.secondaryButton}
                    style={{ flexShrink: 0, fontSize: 12 }}
                  >
                    {copied === form.formUrl ? 'Copied!' : 'Copy link'}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    ) : null}
  </>;
}
