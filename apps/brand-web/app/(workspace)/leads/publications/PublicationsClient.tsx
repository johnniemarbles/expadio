'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../workspace.module.css';

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

export default function PublicationsClient() {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);

  // Create form state
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
        const srcId = typeof body.captureSourceId === 'string' ? body.captureSourceId : null;
        setNotice({
          kind: 'success',
          text: [
            `Publication created (DRAFT). Capture source: ${srcId ?? '—'}.`,
            url ? `Hosted form URL: ${url}` : '',
          ].filter(Boolean).join(' '),
        });
        setCaptureConfigId('');
        setCaptureSourceLabel('');
        await load();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setCreating(false);
    }
  }

  const SUPPORTED_MODES = ['HOSTED_FORM', 'REST_API', 'SIGNED_WEBHOOK', 'EMAIL_LINK', 'SOCIAL_LINK', 'JS_WIDGET', 'IFRAME', 'WHATSAPP_SMS_LINK', 'QR_CODE'];

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
          A publication ties one PUBLISHED Capture Configuration to one channel. Each publication gets its own Capture Source — the attribution anchor for all submissions through that channel. A Capture Source is never shared across publications.
        </p>
        <form onSubmit={createPublication} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Capture Configuration ID *
            <input
              value={captureConfigId}
              onChange={(e) => setCaptureConfigId(e.target.value)}
              placeholder="UUID of a PUBLISHED configuration"
              required
              disabled={creating}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Channel source label *
            <input
              value={captureSourceLabel}
              onChange={(e) => setCaptureSourceLabel(e.target.value)}
              placeholder='e.g. "Website /opportunity" or "Google Ads APAC"'
              required
              maxLength={200}
              disabled={creating}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Publication mode
            <select
              value={publicationMode}
              onChange={(e) => setPublicationMode(e.target.value)}
              disabled={creating}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
            >
              {SUPPORTED_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>

          {publicationMode === 'HOSTED_FORM' ? <>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Publication slug *
              <input
                value={publicationSlug}
                onChange={(e) => setPublicationSlug(e.target.value)}
                placeholder="/opportunity"
                required
                disabled={creating}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
              />
              <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>Must be interest-type-neutral (e.g. /opportunity, /join, /apply). Cannot be /franchise, /distributor, etc.</small>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Brand domain *
              <input
                value={brandDomain}
                onChange={(e) => setBrandDomain(e.target.value)}
                placeholder="apply.yourbrand.com"
                required
                disabled={creating}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
              />
              <small style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>No https:// prefix. The platform serves over HTTPS only.</small>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Post-submit redirect URL (optional)
              <input
                value={postSubmitRedirectUrl}
                onChange={(e) => setPostSubmitRedirectUrl(e.target.value)}
                placeholder="https://yourbrand.com/thank-you"
                disabled={creating}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enablePreFill}
                onChange={(e) => setEnablePreFill(e.target.checked)}
                disabled={creating}
              />
              Enable pre-fill for identified visitors
            </label>
          </> : null}

          <button type="submit" disabled={creating} className={styles.button} style={{ width: 'fit-content' }}>
            {creating ? 'Creating…' : 'Create publication'}
          </button>
        </form>
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
        <div className={styles.empty}>No publications yet. Create one above from a PUBLISHED Capture Configuration.</div>
      ) : null}

      {publications.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Interest type</th>
                <th>Hosted form URL</th>
                <th>Capture source</th>
                <th>Keys</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((pub) => (
                <tr key={pub.publicationId}>
                  <td>
                    <span className={styles.pill}>{pub.publicationMode}</span>
                    <br /><small style={{ fontFamily: 'monospace', fontSize: 10 }}>{pub.publicationId.slice(0, 8)}…</small>
                  </td>
                  <td>
                    <strong>{pub.interestType}</strong>
                    {pub.opportunityType ? <><br /><small>{pub.opportunityType}</small></> : null}
                  </td>
                  <td>
                    {pub.hostedFormUrl ? (
                      <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{pub.hostedFormUrl}</code>
                    ) : (
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {pub.captureSourceLabel ? <><strong style={{ fontSize: 12 }}>{pub.captureSourceLabel}</strong></> : null}
                    {pub.captureSourceId ? <><br /><small style={{ fontFamily: 'monospace', fontSize: 10 }}>{pub.captureSourceId.slice(0, 8)}…</small></> : null}
                  </td>
                  <td style={{ fontSize: 10, fontFamily: 'monospace', lineHeight: 1.8 }}>
                    <div title={`Schema: ${pub.schemaKey}`}>S: {pub.schemaKey.split(':').slice(-2).join(':')}</div>
                    <div title={`Qualification: ${pub.qualificationProfileKey}`}>Q: {pub.qualificationProfileKey.split(':').slice(-2).join(':')}</div>
                    <div title={`Evidence: ${pub.evidenceProfileKey}`}>E: {pub.evidenceProfileKey.split(':').slice(-2).join(':')}</div>
                  </td>
                  <td>
                    <span className={styles.pill} style={{ color: STATUS_COLORS[pub.status] ?? 'var(--theme-text-muted)' }}>
                      {pub.status}
                    </span>
                    {pub.activatedAt ? <><br /><small>Active {new Date(pub.activatedAt).toLocaleDateString()}</small></> : null}
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
