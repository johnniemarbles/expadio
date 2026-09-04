'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../workspace.module.css';

type PublishedConfig = {
  configId: string;
  interestType: string;
  opportunityType: string | null;
  label: string;
};

type Publication = {
  publicationId: string;
  captureConfigId: string;
  interestType: string;
  opportunityType: string | null;
  schemaKey: string;
  qualificationProfileKey: string;
  evidenceProfileKey: string;
  publicationMode: string;
  publicationSlug: string | null;
  brandDomain: string | null;
  hostedFormUrl: string | null;
  postSubmitRedirectUrl: string | null;
  enablePreFill: boolean | null;
  status: string;
  captureSourceId: string | null;
  captureSourceLabel: string | null;
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'var(--theme-text-muted)',
  ACTIVE: 'green',
  PAUSED: 'orange',
  ARCHIVED: 'var(--theme-text-muted)',
};

const INTEREST_LABELS: Record<string, string> = {
  'FRANCHISEE:SINGLE_UNIT': 'Franchise — Single Unit',
  'FRANCHISEE:MULTI_UNIT': 'Franchise — Multi-Unit',
  'FRANCHISEE:AREA_DEVELOPMENT': 'Franchise — Area Development',
  'FRANCHISEE:CONVERSION': 'Franchise — Conversion',
  'FRANCHISEE:RESALE': 'Franchise — Resale',
  'MASTER_FRANCHISEE': 'Master Franchise',
  'DISTRIBUTOR:EXCLUSIVE_DISTRIBUTOR': 'Distribution — Exclusive',
  'DISTRIBUTOR:NON_EXCLUSIVE_DISTRIBUTOR': 'Distribution — Non-Exclusive',
  'DISTRIBUTOR:MASTER_DISTRIBUTOR': 'Distribution — Master',
  'DISTRIBUTOR:SUB_DISTRIBUTOR': 'Distribution — Sub-Distributor',
  'AFFILIATE': 'Affiliate Partner',
  'LICENSEE': 'License',
  'AGENT': 'Sales Agent',
};

function configLabel(c: { interestType: string; opportunityType: string | null }): string {
  const key = c.opportunityType ? `${c.interestType}:${c.opportunityType}` : c.interestType;
  return INTEREST_LABELS[key] ?? key;
}

const SUPPORTED_MODES = [
  'HOSTED_FORM', 'REST_API', 'SIGNED_WEBHOOK', 'EMAIL_LINK',
  'SOCIAL_LINK', 'JS_WIDGET', 'IFRAME', 'WHATSAPP_SMS_LINK', 'QR_CODE',
];

const MODE_LABELS: Record<string, string> = {
  HOSTED_FORM: 'Hosted form (apply.yourbrand.com/opportunity)',
  REST_API: 'REST API',
  SIGNED_WEBHOOK: 'Signed webhook',
  EMAIL_LINK: 'Email link',
  SOCIAL_LINK: 'Social link',
  JS_WIDGET: 'JavaScript widget',
  IFRAME: 'Embed (iframe)',
  WHATSAPP_SMS_LINK: 'WhatsApp / SMS link',
  QR_CODE: 'QR code',
};

export default function PublicationsClient() {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [publishedConfigs, setPublishedConfigs] = useState<PublishedConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [captureConfigId, setCaptureConfigId] = useState('');
  const [publicationMode, setPublicationMode] = useState('HOSTED_FORM');
  const [publicationSlug, setPublicationSlug] = useState('/opportunity');
  const [brandDomain, setBrandDomain] = useState('');
  const [captureSourceLabel, setCaptureSourceLabel] = useState('');
  const [enablePreFill, setEnablePreFill] = useState(false);
  const [postSubmitRedirectUrl, setPostSubmitRedirectUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/leads/publications', { cache: 'no-store' });
      const body = await readJson(r);
      if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to load publications.');
      setPublications(Array.isArray(body.publications) ? body.publications as Publication[] : []);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load publications.' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Load PUBLISHED configurations once for the dropdown
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/leads/management/configurations', { cache: 'no-store' });
        const body = await readJson(r);
        const all = Array.isArray(body.configurations) ? body.configurations as Array<Record<string, unknown>> : [];
        const published: PublishedConfig[] = all
          .filter((c) => c.status === 'PUBLISHED')
          .map((c) => ({
            configId: String(c.configId ?? ''),
            interestType: String(c.interestType ?? ''),
            opportunityType: typeof c.opportunityType === 'string' ? c.opportunityType : null,
            label: configLabel({ interestType: String(c.interestType ?? ''), opportunityType: typeof c.opportunityType === 'string' ? c.opportunityType : null }),
          }));
        setPublishedConfigs(published);
        if (published.length > 0 && !captureConfigId) {
          setCaptureConfigId(published[0].configId);
        }
      } catch {
        // non-fatal — user can still try
      } finally {
        setConfigsLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createPublication(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        captureConfigId: captureConfigId.trim(),
        publicationMode,
        captureSourceLabel: captureSourceLabel.trim(),
      };
      if (publicationMode === 'HOSTED_FORM') {
        payload.publicationSlug = publicationSlug.trim();
        payload.brandDomain = brandDomain.trim();
        payload.enablePreFill = enablePreFill;
        if (postSubmitRedirectUrl.trim()) payload.postSubmitRedirectUrl = postSubmitRedirectUrl.trim();
      }

      const r = await fetch('/api/leads/publications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(r);
      if (!r.ok) {
        setNotice({ kind: 'error', text: typeof body.error === 'string' ? body.error : 'Creation failed.' });
      } else {
        const url = typeof body.hostedFormUrl === 'string' ? body.hostedFormUrl : null;
        setNotice({
          kind: 'success',
          text: [
            'Publication created.',
            url ? `Hosted form: ${url}` : '',
          ].filter(Boolean).join(' '),
        });
        setCaptureSourceLabel('');
        await load();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setCreating(false);
    }
  }

  const selectedConfig = publishedConfigs.find((c) => c.configId === captureConfigId);

  const inputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, width: '100%', boxSizing: 'border-box' as const };
  const labelStyle = { display: 'grid' as const, gap: 4, fontSize: 12, fontWeight: 700 };

  return <>
    {notice ? (
      <div className={styles.notice}>
        <strong>{notice.kind === 'success' ? 'Done' : 'Error'}</strong>
        <p>{notice.text}</p>
      </div>
    ) : null}

    {/* ── Create publication ────────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>New publication</h2></div>
      <div className={styles.panelBody}>
        <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', marginTop: 0 }}>
          Each publication connects one of your active interest-type configurations to a channel (website form, API, embed, etc.) and gets its own attribution source for analytics.
        </p>

        {!configsLoading && publishedConfigs.length === 0 ? (
          <div className={styles.notice}>
            <strong>No published configurations yet.</strong>
            <p>Go to <strong>Capture Configuration</strong> to activate and publish an interest type first, then return here to create a publication.</p>
          </div>
        ) : (
          <form onSubmit={createPublication} style={{ display: 'grid', gap: 16, maxWidth: 520 }}>

            {/* Interest type — friendly dropdown instead of UUID */}
            <label style={labelStyle}>
              Interest type
              {configsLoading ? (
                <div style={{ ...inputStyle, color: 'var(--theme-text-muted)' }}>Loading…</div>
              ) : (
                <select
                  value={captureConfigId}
                  onChange={(e) => setCaptureConfigId(e.target.value)}
                  required
                  disabled={creating}
                  style={inputStyle}
                >
                  <option value="" disabled>Select an interest type…</option>
                  {publishedConfigs.map((c) => (
                    <option key={c.configId} value={c.configId}>{c.label}</option>
                  ))}
                </select>
              )}
              {selectedConfig && (
                <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontFamily: 'monospace', fontSize: 10 }}>
                  Config ID: {selectedConfig.configId}
                </small>
              )}
            </label>

            {/* Channel */}
            <label style={labelStyle}>
              Channel type
              <select
                value={publicationMode}
                onChange={(e) => setPublicationMode(e.target.value)}
                disabled={creating}
                style={inputStyle}
              >
                {SUPPORTED_MODES.map((m) => (
                  <option key={m} value={m}>{MODE_LABELS[m] ?? m}</option>
                ))}
              </select>
            </label>

            {/* Channel label */}
            <label style={labelStyle}>
              Channel name *
              <input
                value={captureSourceLabel}
                onChange={(e) => setCaptureSourceLabel(e.target.value)}
                placeholder={publicationMode === 'HOSTED_FORM' ? 'e.g. Website /opportunity' : 'e.g. Google Ads APAC campaign'}
                required
                maxLength={200}
                disabled={creating}
                style={inputStyle}
              />
              <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>A short label used in reports and attribution (e.g. "Website /opportunity", "LinkedIn AU").</small>
            </label>

            {/* HOSTED_FORM-specific fields */}
            {publicationMode === 'HOSTED_FORM' ? <>
              <label style={labelStyle}>
                Your brand domain *
                <input
                  value={brandDomain}
                  onChange={(e) => setBrandDomain(e.target.value)}
                  placeholder="apply.yourbrand.com"
                  required
                  disabled={creating}
                  style={inputStyle}
                />
                <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>The domain where the form will be hosted. No https:// prefix — the platform always serves over HTTPS.</small>
              </label>

              <label style={labelStyle}>
                Form URL path *
                <input
                  value={publicationSlug}
                  onChange={(e) => setPublicationSlug(e.target.value)}
                  placeholder="/opportunity"
                  required
                  disabled={creating}
                  style={inputStyle}
                />
                <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>
                  Must be business-model-neutral — <code>/opportunity</code>, <code>/join</code>, <code>/apply</code> are fine. Interest-type-specific paths like <code>/franchise</code> or <code>/distributor</code> are not allowed.
                </small>
                {brandDomain && publicationSlug ? (
                  <small style={{ color: 'var(--theme-primary)', fontWeight: 400 }}>
                    Preview: <strong>https://{brandDomain}{publicationSlug}</strong>
                  </small>
                ) : null}
              </label>

              <label style={labelStyle}>
                Thank-you redirect URL <span style={{ fontWeight: 400 }}>(optional)</span>
                <input
                  value={postSubmitRedirectUrl}
                  onChange={(e) => setPostSubmitRedirectUrl(e.target.value)}
                  placeholder="https://yourbrand.com/thank-you"
                  disabled={creating}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enablePreFill}
                  onChange={(e) => setEnablePreFill(e.target.checked)}
                  disabled={creating}
                />
                Pre-fill form for returning visitors
              </label>
            </> : null}

            <button type="submit" disabled={creating || !captureConfigId} className={styles.button} style={{ width: 'fit-content' }}>
              {creating ? 'Creating…' : 'Create publication'}
            </button>
          </form>
        )}
      </div>
    </section>

    {/* ── Publication list ──────────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Publications</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={styles.pill}>{loading ? 'LOADING' : `${publications.length} TOTAL`}</span>
          <button className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
      </div>

      {!loading && publications.length === 0 ? (
        <div className={styles.empty}>No publications yet. Create one above once you have a published interest-type configuration.</div>
      ) : null}

      {publications.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Interest type</th>
                <th>Channel</th>
                <th>Form URL</th>
                <th>Attribution source</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((pub) => (
                <tr key={pub.publicationId}>
                  <td>
                    <strong>{configLabel({ interestType: pub.interestType, opportunityType: pub.opportunityType })}</strong>
                    {pub.opportunityType ? <><br /><small style={{ color: 'var(--theme-text-muted)' }}>{pub.opportunityType}</small></> : null}
                  </td>
                  <td>
                    <span className={styles.pill}>{MODE_LABELS[pub.publicationMode] ?? pub.publicationMode}</span>
                  </td>
                  <td>
                    {pub.hostedFormUrl ? (
                      <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{pub.hostedFormUrl}</code>
                    ) : (
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {pub.captureSourceLabel ? <strong style={{ fontSize: 12 }}>{pub.captureSourceLabel}</strong> : null}
                    {pub.captureSourceId ? <><br /><small style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--theme-text-muted)' }}>{pub.captureSourceId.slice(0, 8)}…</small></> : null}
                  </td>
                  <td>
                    <span className={styles.pill} style={{ color: STATUS_COLORS[pub.status] ?? 'var(--theme-text-muted)' }}>
                      {pub.status}
                    </span>
                    {pub.activatedAt ? <><br /><small>Since {new Date(pub.activatedAt).toLocaleDateString()}</small></> : null}
                  </td>
                  <td><small>{new Date(pub.createdAt).toLocaleDateString()}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  </>;
}
