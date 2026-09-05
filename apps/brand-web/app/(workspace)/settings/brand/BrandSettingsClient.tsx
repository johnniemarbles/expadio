'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../workspace.module.css';

const PLATFORM_DOMAIN = 'expadio.com';
const CNAME_TARGET = 'forms.expadio.com';

async function checkCloudflareConnector(): Promise<boolean> {
  try {
    const res = await fetch('/api/settings/brand/cloudflare', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    return body?.connectorAvailable === true;
  } catch {
    return false;
  }
}

interface BrandSettings {
  brandSlug: string | null;
  brandDisplayName: string | null;
  brandDomain: string | null;
  brandDomainVerifiedAt: string | null;
}

type Notice = { kind: 'success' | 'error'; text: string } | null;

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export default function BrandSettingsClient({
  initialSettings,
}: {
  initialSettings: BrandSettings;
}) {
  const [slug, setSlug] = useState(initialSettings.brandSlug ?? '');
  const [displayName, setDisplayName] = useState(initialSettings.brandDisplayName ?? '');
  const [domain, setDomain] = useState(initialSettings.brandDomain ?? '');
  const [verifiedAt, setVerifiedAt] = useState<string | null>(initialSettings.brandDomainVerifiedAt);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cfConfiguring, setCfConfiguring] = useState(false);
  const [cfConnectorAvailable, setCfConnectorAvailable] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; message?: string } | null>(null);

  const cleanDomain = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const platformUrl = slug.trim() ? `https://${slug.trim()}.${PLATFORM_DOMAIN}/enquire` : null;
  const customUrl = verifiedAt && cleanDomain ? `https://${cleanDomain}/enquire` : null;

  useEffect(() => {
    void checkCloudflareConnector().then(setCfConnectorAvailable);
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/brand', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandSlug: slug.trim().toLowerCase() || null,
          brandDisplayName: displayName.trim() || null,
          brandDomain: cleanDomain || null,
        }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        setNotice({ kind: 'error', text: typeof body.error === 'string' ? body.error : 'Could not save settings.' });
        return;
      }
      if (typeof body.brandDomainVerifiedAt === 'string') setVerifiedAt(body.brandDomainVerifiedAt);
      else if (body.brandDomainVerifiedAt === null) setVerifiedAt(null);
      setVerifyResult(null);
      setNotice({ kind: 'success', text: 'Brand settings saved.' });
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    if (verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/settings/brand/verify', { method: 'POST' });
      const body = await readJson(res);
      if (!res.ok) {
        setVerifyResult({ verified: false, message: typeof body.error === 'string' ? body.error : 'Verification failed.' });
        return;
      }
      const verified = body.verified === true;
      setVerifyResult({
        verified,
        message: verified ? undefined : (typeof body.message === 'string' ? body.message : undefined),
      });
      if (verified) setVerifiedAt(new Date().toISOString());
    } finally {
      setVerifying(false);
    }
  }

  async function cfConfigure() {
    if (cfConfiguring) return;
    setCfConfiguring(true);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/settings/brand/cloudflare', { method: 'POST' });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        setVerifyResult({ verified: false, message: typeof body.error === 'string' ? body.error : 'Cloudflare configuration failed.' });
        return;
      }
      const verified = body.verified === true;
      setVerifyResult({
        verified,
        message: verified
          ? `CNAME ${body.domain ?? ''} → ${body.expected ?? CNAME_TARGET} confirmed${body.action === 'created' ? ' (record created)' : body.action === 'updated' ? ' (record updated)' : ''}.`
          : `Record written but CNAME content mismatch — found: ${body.cname ?? '(none)'}.`,
      });
      if (verified) setVerifiedAt(new Date().toISOString());
    } finally {
      setCfConfiguring(false);
    }
  }

  const slugPreview = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  return <>
    {notice ? (
      <div className={styles.notice}>
        <strong>{notice.kind === 'success' ? 'Saved' : 'Error'}</strong>
        <p>{notice.text}</p>
      </div>
    ) : null}

    {/* ── Brand identity ──────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Brand identity</h2></div>
      <div className={styles.panelBody} style={{ display: 'grid', gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', margin: 0 }}>
          Your brand identity controls how your enquiry forms appear and the default platform URL your leads use.
        </p>

        <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 4, maxWidth: 400 }}>
          Display name
          <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)', fontSize: 11 }}>
            Shown to candidates on enquiry forms
          </span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Acme Franchise Group"
            disabled={saving}
            style={{
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-surface)',
              color: 'var(--theme-text-primary)', fontSize: 13,
            }}
          />
        </label>

        <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 4, maxWidth: 400 }}>
          Platform slug
          <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)', fontSize: 11 }}>
            3–50 lowercase letters, digits, or hyphens. Gives you a free platform URL.
          </span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="acme-franchise"
            disabled={saving}
            style={{
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-surface)',
              color: 'var(--theme-text-primary)', fontSize: 13, fontFamily: 'monospace',
            }}
          />
          {slugPreview.length >= 3 ? (
            <span style={{ fontSize: 11, color: 'var(--theme-text-muted)', fontFamily: 'monospace' }}>
              {slugPreview}.{PLATFORM_DOMAIN}
            </span>
          ) : null}
        </label>
      </div>
    </section>

    {/* ── Custom domain ────────────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Custom domain</h2>
        {verifiedAt ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'green', letterSpacing: '0.04em' }}>VERIFIED</span>
        ) : cleanDomain ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--theme-text-muted)', letterSpacing: '0.04em' }}>UNVERIFIED</span>
        ) : null}
      </div>
      <div className={styles.panelBody} style={{ display: 'grid', gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', margin: 0 }}>
          Use your own domain (e.g. <code>apply.yourbrand.com</code>) for all enquiry form links.
          After entering it, point a CNAME record to <code>{CNAME_TARGET}</code> and click <strong>Verify</strong>.
        </p>

        <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 4, maxWidth: 400 }}>
          Your domain
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value.replace(/^https?:\/\//, ''))}
            placeholder="apply.yourbrand.com"
            disabled={saving}
            style={{
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-surface)',
              color: 'var(--theme-text-primary)', fontSize: 13, fontFamily: 'monospace',
            }}
          />
        </label>

        {cleanDomain ? (
          <div style={{
            background: 'var(--theme-surface)',
            border: '1px solid var(--theme-border)',
            borderRadius: 8, padding: '12px 14px',
            display: 'grid', gap: 8, maxWidth: 500,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>DNS setup</p>
            <p style={{ fontSize: 12, color: 'var(--theme-text-muted)', margin: 0 }}>
              Add this CNAME record in your DNS provider, then click Verify:
            </p>
            <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Type', 'Name', 'Value'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>CNAME</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{cleanDomain.split('.')[0]}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{CNAME_TARGET}</td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: 'var(--theme-text-muted)', margin: 0 }}>
              DNS changes can take up to 48 hours to propagate.
            </p>
          </div>
        ) : null}

        {verifyResult ? (
          <div className={styles.notice} style={{ marginTop: 0 }}>
            <strong>{verifyResult.verified ? 'Verified!' : 'Not verified yet'}</strong>
            {verifyResult.message ? <p>{verifyResult.message}</p> : null}
          </div>
        ) : null}

        {cleanDomain ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {cfConnectorAvailable ? (
              <button
                onClick={() => void cfConfigure()}
                disabled={cfConfiguring || saving}
                className={styles.button}
                style={{ width: 'fit-content' }}
              >
                {cfConfiguring ? 'Configuring…' : '⚡ Auto-configure with Cloudflare'}
              </button>
            ) : null}
            <button
              onClick={() => void verify()}
              disabled={verifying || saving || cfConfiguring}
              className={styles.secondaryButton}
              style={{ width: 'fit-content' }}
            >
              {verifying ? 'Checking DNS…' : verifiedAt ? 'Re-verify' : 'Verify domain'}
            </button>
          </div>
        ) : null}
      </div>
    </section>

        {/* ── Telegram Linking ───────────────────────────────────────── */}
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Telegram linking</h2>
      </div>
      <div className={styles.panelBody} style={{ display: 'grid', gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', margin: 0 }}>
          Link your Telegram account to receive approval requests directly on your device.
        </p>
        <button
          onClick={async () => {
            try {
              const res = await fetch('/api/telegram/link', { method: 'POST' });
              if (res.ok) {
                alert('Successfully linked Telegram.');
              } else {
                alert('Failed to link Telegram: ' + (await res.json()).error);
              }
            } catch (err) {
              alert('Error linking Telegram: ' + err);
            }
          }}
          disabled={saving}
          className={styles.secondaryButton}
          style={{ width: 'fit-content' }}
        >
          Link Telegram Account
        </button>
      </div>
    </section>

    {/* ── Save ─────────────────────────────────────────────────────── */}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        className={styles.button}
        onClick={() => void save()}
        disabled={saving}
        style={{ width: 'fit-content' }}
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>

    {/* ── Your enquiry URLs ─────────────────────────────────────────── */}
    {(platformUrl || customUrl) ? (
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Your enquiry URLs</h2></div>
        <div style={{ display: 'grid', gap: 8, padding: '0 16px 16px' }}>
          {platformUrl ? (
            <UrlRow label="Platform default" url={platformUrl} />
          ) : null}
          {customUrl ? (
            <UrlRow label="Custom domain" url={customUrl} />
          ) : null}
        </div>
      </section>
    ) : null}
  </>;
}

function UrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch { /* non-fatal */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', borderRadius: 8,
      border: '1px solid var(--theme-border)',
      background: 'var(--theme-surface)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
        <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{url}</code>
      </div>
      <button onClick={() => void copy()} className={styles.secondaryButton} style={{ flexShrink: 0, fontSize: 12 }}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
