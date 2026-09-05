"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import styles from './CommunicationsManager.module.css';

type DnsRecord = {
  type: string; name: string; value: string; priority?: number; purpose: string; verifiable?: boolean;
};
type CfRecordResult = { name: string; ok: boolean; action?: string; detail: string };
type TemplateRow = {
  templateId: string; version: number; triggerKey: string; channel: string; locale: string;
  subject: string | null; title: string | null; body: string; status: string; updatedAt: string;
};
type SenderRow = {
  senderId: string; address: string; domain: string; displayName: string | null;
  purposes: string[]; isDefault: boolean; verificationStatus: string; status: string; dnsRecords: DnsRecord[];
};
type SuppressionRow = {
  suppressionId: string; recipientKey: string; channel: string; reason: string; status: string; recordedAt: string;
};
type VerifyResult = {
  spfOk: boolean; dmarcOk: boolean; providerChecked: boolean; providerOk: boolean;
  verificationStatus: string; dnsVerified: boolean;
};

type WizardPhase = 'closed' | 'form' | 'dns' | 'done';
type DnsMode = 'cloudflare' | 'manual';

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || 'Request failed.');
  return data;
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'VERIFIED' ? styles.badgeGreen
    : status === 'PENDING' ? styles.badgeYellow
    : styles.badgeGray;
  return <span className={cls}>{status}</span>;
}

function DnsRecordTable({
  records,
  cfResults,
  verifyResult,
}: {
  records: DnsRecord[];
  cfResults?: CfRecordResult[];
  verifyResult?: VerifyResult | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(key: string, value: string) {
    copyText(value);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  }

  function statusIcon(record: DnsRecord): string | null {
    if (!verifyResult) {
      const cf = cfResults?.find((r) => r.name === record.name);
      if (cf) return cf.ok ? '✓' : '✗';
      return null;
    }
    if (record.purpose === 'SPF') return verifyResult.spfOk ? '✓' : '✗';
    if (record.purpose === 'DMARC') return verifyResult.dmarcOk ? '✓' : '✗';
    if (record.purpose === 'DKIM') return null;
    return null;
  }

  return (
    <div className={styles.dnsTableWrap}>
      <table className={styles.dnsTable}>
        <thead>
          <tr>
            <th>Purpose</th>
            <th>Type</th>
            <th>Host</th>
            <th>Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const key = `${r.purpose}:${r.name}`;
            const icon = statusIcon(r);
            return (
              <tr key={key} className={icon === '✗' ? styles.rowFail : undefined}>
                <td>
                  {icon && (
                    <span className={icon === '✓' ? styles.iconOk : styles.iconFail}>{icon}</span>
                  )}{' '}
                  {r.purpose}
                </td>
                <td>{r.type}{r.priority !== undefined ? ` (pri ${r.priority})` : ''}</td>
                <td className={styles.mono}>{r.name}</td>
                <td className={styles.mono}>{r.value}</td>
                <td>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={() => handleCopy(key, `${r.name}\t${r.value}`)}
                  >
                    {copied === key ? 'Copied' : 'Copy'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SenderDnsGuide({ records }: { records: DnsRecord[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.dnsGuide} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={styles.dnsSummary}>DNS records required for verification</summary>
      <DnsRecordTable records={records} />
    </details>
  );
}

export function CommunicationsManager() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [senders, setSenders] = useState<SenderRow[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Wizard state
  const [wizardPhase, setWizardPhase] = useState<WizardPhase>('closed');
  const [dnsMode, setDnsMode] = useState<DnsMode>('manual');
  const [cfAvailable, setCfAvailable] = useState<boolean>(false);
  const [wizardSenderId, setWizardSenderId] = useState('');
  const [wizardDomain, setWizardDomain] = useState('');
  const [wizardDnsRecords, setWizardDnsRecords] = useState<DnsRecord[]>([]);
  const [cfResults, setCfResults] = useState<CfRecordResult[]>([]);
  const [cfProvisioned, setCfProvisioned] = useState(false);
  const [cfMessage, setCfMessage] = useState('');
  const [wizardVerifyResult, setWizardVerifyResult] = useState<VerifyResult | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const wizardRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const [templateData, senderData, suppressionData] = await Promise.all([
      fetch('/api/communications/templates', { cache: 'no-store' }).then(responseJson),
      fetch('/api/communications/senders', { cache: 'no-store' }).then(responseJson),
      fetch('/api/communications/suppressions?status=ACTIVE&limit=100', { cache: 'no-store' }).then(responseJson),
    ]);
    setTemplates(Array.isArray(templateData) ? templateData : []);
    setSenders(Array.isArray(senderData) ? senderData : []);
    setSuppressions(Array.isArray(suppressionData?.items) ? suppressionData.items : []);
  }, []);

  useEffect(() => {
    reload().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load communication controls.'));
  }, [reload]);

  // Check CF connector availability whenever wizard opens to form phase
  useEffect(() => {
    if (wizardPhase !== 'dns') return;
    fetch('/api/communications/domains/cloudflare', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const available = d?.connectorAvailable === true;
        setCfAvailable(available);
        setDnsMode(available ? 'cloudflare' : 'manual');
      })
      .catch(() => { setCfAvailable(false); setDnsMode('manual'); });
  }, [wizardPhase]);

  // Scroll wizard into view when it opens
  useEffect(() => {
    if (wizardPhase !== 'closed') {
      setTimeout(() => wizardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }, [wizardPhase]);

  function openWizard() {
    setWizardPhase('form');
    setWizardError(null);
    setWizardSenderId('');
    setWizardDomain('');
    setWizardDnsRecords([]);
    setCfResults([]);
    setCfProvisioned(false);
    setCfMessage('');
    setWizardVerifyResult(null);
  }

  function closeWizard() {
    setWizardPhase('closed');
    setWizardError(null);
  }

  async function handleRegisterSender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWizardError(null);
    setBusy('sender');
    const form = new FormData(event.currentTarget);
    const address = String(form.get('address') || '').trim().toLowerCase();
    const displayName = String(form.get('displayName') || '').trim() || undefined;
    const replyTo = String(form.get('replyTo') || '').trim() || undefined;
    const domain = address.includes('@') ? address.split('@')[1] ?? '' : '';

    try {
      const result = await responseJson(await fetch('/api/communications/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          address,
          displayName,
          replyTo,
          purposes: ['transactional'],
        }),
      }));
      const senderId: string = result?.sender?.sender_id ?? result?.sender?.senderId ?? '';
      if (!senderId) throw new Error('Sender registered but ID not returned.');

      // Build expected DNS records for display
      const dnsRecords: DnsRecord[] = [
        { type: 'TXT', name: domain, value: `v=spf1 include:amazonses.com include:_spf.resend.com ~all`, purpose: 'SPF', verifiable: true },
        { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${domain}`, purpose: 'DMARC', verifiable: true },
        { type: 'MX', name: `mail.${domain}`, value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, purpose: 'Return-path (MX)', verifiable: true },
        { type: 'TXT', name: `resend._domainkey.${domain}`, value: 'Issued by Resend — add the DKIM key from your Resend domain settings', purpose: 'DKIM', verifiable: false },
      ];
      setWizardSenderId(senderId);
      setWizardDomain(domain);
      setWizardDnsRecords(dnsRecords);
      setWizardPhase('dns');
      await reload();
    } catch (cause) {
      setWizardError(cause instanceof Error ? cause.message : 'Could not register sender.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCloudflareConfigure() {
    setWizardError(null);
    setBusy('cfconfigure');
    try {
      const result = await responseJson(await fetch('/api/communications/domains/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: wizardDomain }),
      }));
      setCfProvisioned(result.provisioned === true);
      setCfResults(Array.isArray(result.cloudflare) ? result.cloudflare : []);
      setCfMessage(result.message ?? '');
      if (Array.isArray(result.records)) setWizardDnsRecords(result.records);
    } catch (cause) {
      setWizardError(cause instanceof Error ? cause.message : 'Cloudflare configuration failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleVerify() {
    setWizardError(null);
    setBusy('verify');
    try {
      const result = await responseJson(await fetch(
        `/api/communications/senders/${encodeURIComponent(wizardSenderId)}/verify`,
        { method: 'POST' },
      ));
      setWizardVerifyResult({
        spfOk: result.spfOk ?? false,
        dmarcOk: result.dmarcOk ?? false,
        providerChecked: result.providerChecked ?? false,
        providerOk: result.providerOk ?? false,
        verificationStatus: result.verificationStatus ?? 'PENDING',
        dnsVerified: result.dnsVerified ?? false,
      });
      if (result.verificationStatus === 'VERIFIED') {
        setWizardPhase('done');
      }
      await reload();
    } catch (cause) {
      setWizardError(cause instanceof Error ? cause.message : 'Verification failed.');
    } finally {
      setBusy(null);
    }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('template'); setError(null); setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await responseJson(await fetch('/api/communications/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerKey: String(form.get('triggerKey') || ''),
          channel: String(form.get('channel') || 'email'),
          locale: 'en',
          contentFormat: String(form.get('contentFormat') || 'TEXT'),
          subject: String(form.get('subject') || '') || null,
          body: String(form.get('body') || ''),
          requiredVariables: [],
          defaultVariables: {},
        }),
      }));
      event.currentTarget.reset();
      setNotice('Draft template created. Publication remains a separate governed step.');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create template.'); }
    finally { setBusy(null); }
  }

  async function promoteSender(senderId: string) {
    setBusy(senderId); setError(null); setNotice(null);
    try {
      await responseJson(await fetch('/api/communications/senders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId, isDefault: true }),
      }));
      setNotice('Verified sender selected as the organization default.');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not select sender.'); }
    finally { setBusy(null); }
  }

  async function retireSender(senderId: string) {
    setBusy(senderId); setError(null); setNotice(null);
    try {
      await responseJson(await fetch(`/api/communications/senders/${encodeURIComponent(senderId)}`, { method: 'DELETE' }));
      setNotice('Sender retired.');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retire sender.'); }
    finally { setBusy(null); }
  }

  async function verifySender(senderId: string) {
    setBusy(senderId + 'verify'); setError(null); setNotice(null);
    try {
      const result = await responseJson(await fetch(`/api/communications/senders/${encodeURIComponent(senderId)}/verify`, { method: 'POST' }));
      if (result.verificationStatus === 'VERIFIED') {
        setNotice('Sender verified and ready for sending.');
      } else {
        const dns = `SPF: ${result.spfOk ? '✓' : '✗'}  DMARC: ${result.dmarcOk ? '✓' : '✗'}${result.providerChecked ? `  Resend: ${result.providerOk ? '✓' : '✗'}` : ' Resend: not checked'}`;
        setNotice(`Verification pending. Add the required DNS records and try again.\n${dns}`);
      }
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Verification failed.'); }
    finally { setBusy(null); }
  }

  async function createSuppression(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('suppression'); setError(null); setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await responseJson(await fetch('/api/communications/suppressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientKey: String(form.get('recipientKey') || ''),
          channel: String(form.get('channel') || 'email'),
          reason: String(form.get('reason') || 'OPT_OUT'),
        }),
      }));
      event.currentTarget.reset();
      setNotice('Organization suppression recorded.');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create suppression.'); }
    finally { setBusy(null); }
  }

  async function revokeSuppression(suppressionId: string) {
    setBusy(suppressionId); setError(null); setNotice(null);
    try {
      await responseJson(await fetch(`/api/communications/suppressions/${encodeURIComponent(suppressionId)}`, { method: 'DELETE' }));
      setNotice('Organization suppression revoked; all other eligibility checks still apply.');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not revoke suppression.'); }
    finally { setBusy(null); }
  }

  const hasVerifiedSender = senders.some((s) => s.verificationStatus === 'VERIFIED' && s.status === 'ACTIVE');

  return (
    <section className={styles.manager} aria-label="Brand communication controls">
      {/* Two-Plane Health Meters */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ padding: 16, borderRadius: 10, background: '#121514', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: 'var(--theme-primary)', fontWeight: 'bold' }}>⚡ Transactional Plane</span>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#22C55E', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 4 }}>p95 142ms (&lt;380ms)</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--theme-text-primary)', marginTop: 6 }}>OTP &amp; Security Verification Dispatch</div>
          <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 4 }}>Inherited BYOK Credentials: <strong style={{ color: '#FACC15' }}>Twilio Voice/SMS · Resend SES</strong></div>
        </div>

        <div style={{ padding: 16, borderRadius: 10, background: '#121514', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#FACC15', fontWeight: 'bold' }}>📊 Bulk Campaign Plane</span>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#FACC15', background: 'rgba(250,204,21,0.1)', padding: '2px 8px', borderRadius: 4 }}>Rate Budget: 50 req/sec</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--theme-text-primary)', marginTop: 6 }}>Rate-Budgeted Drip &amp; Marketing Campaigns</div>
          <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 4 }}>Inherited BYOK Credentials: <strong style={{ color: '#FACC15' }}>Meta WhatsApp API · SendGrid Bulk</strong></div>
        </div>
      </div>

      <div className={styles.managerHeader}>
        <div>
          <p className={styles.eyebrow}>Organization controls</p>
          <h2>Messaging configuration</h2>
        </div>
        <button type="button" className={styles.secondary} onClick={() => reload().catch(() => {})}>Refresh</button>
      </div>
      <p className={styles.boundary}>Manage organization content, sender identities, and suppressions here.</p>
      {error && <div className={styles.error} role="alert" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
      {notice && <div className={styles.notice} role="status" style={{ whiteSpace: 'pre-line' }}>{notice}</div>}

      <div className={styles.columns}>
        {/* ── Template drafts ─────────────────────────────── */}
        <article className={styles.panel}>
          <h3>Template drafts</h3>
          <p className={styles.help}>Create organization-owned drafts. This surface does not publish them.</p>
          <form className={styles.form} onSubmit={createTemplate}>
            <label>Trigger key<input name="triggerKey" required placeholder="appointment.reminder" /></label>
            <div className={styles.row}>
              <label>Channel
                <select name="channel" defaultValue="email">
                  <option>email</option><option>sms</option><option>whatsapp</option>
                  <option>voice</option><option>push</option><option>rcs</option>
                </select>
              </label>
              <label>Format
                <select name="contentFormat" defaultValue="TEXT">
                  <option>TEXT</option><option>HTML</option><option>MARKDOWN</option>
                </select>
              </label>
            </div>
            <label>Subject<input name="subject" placeholder="Optional for non-email channels" /></label>
            <label>Body<textarea name="body" required rows={4} /></label>
            <button className={styles.primary} disabled={busy === 'template'}>
              {busy === 'template' ? 'Saving…' : 'Create draft'}
            </button>
          </form>
          <div className={styles.list}>
            {templates.slice(0, 8).map((item) => (
              <div className={styles.item} key={`${item.templateId}:${item.version}`}>
                <div>
                  <strong>{item.triggerKey}</strong>
                  <small>{item.channel} · v{item.version} · {item.status}</small>
                </div>
              </div>
            ))}
            {templates.length === 0 && <p className={styles.empty}>No organization templates yet.</p>}
          </div>
        </article>

        {/* ── Sending identities ──────────────────────────── */}
        <article className={styles.panel}>
          <h3>Sending identities</h3>

          {/* Platform default notice */}
          {!hasVerifiedSender && (
            <div className={styles.platformNotice}>
              <strong>Using tenant shared sender</strong>
              <p>No verified custom sender is configured. Emails dispatch via your tenant's shared sending identity. Register a custom domain below to send from your own address.</p>
            </div>
          )}

          {/* Existing senders list */}
          {senders.length > 0 && (
            <div className={styles.list}>
              {senders.map((sender) => (
                <div className={styles.item} key={sender.senderId}>
                  <div>
                    <strong>{sender.address}</strong>
                    <small>
                      <StatusBadge status={sender.verificationStatus} />
                      {' '}{sender.status}{sender.isDefault ? ' · DEFAULT' : ''}
                    </small>
                    {sender.verificationStatus !== 'VERIFIED' && sender.dnsRecords && (
                      <SenderDnsGuide records={sender.dnsRecords} />
                    )}
                  </div>
                  <div className={styles.actions}>
                    {sender.status === 'ACTIVE' && sender.verificationStatus !== 'VERIFIED' && (
                      <button
                        className={styles.secondary}
                        disabled={busy === sender.senderId + 'verify'}
                        onClick={() => verifySender(sender.senderId)}
                      >
                        {busy === sender.senderId + 'verify' ? 'Checking…' : 'Verify'}
                      </button>
                    )}
                    {sender.status === 'ACTIVE' && sender.verificationStatus === 'VERIFIED' && !sender.isDefault && (
                      <button className={styles.secondary} disabled={busy === sender.senderId} onClick={() => promoteSender(sender.senderId)}>
                        Make default
                      </button>
                    )}
                    {sender.status === 'ACTIVE' && (
                      <button className={styles.danger} disabled={busy === sender.senderId} onClick={() => retireSender(sender.senderId)}>
                        Retire
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add sender button (hidden when wizard is open) */}
          {wizardPhase === 'closed' && (
            <button type="button" className={styles.secondary} onClick={openWizard} style={{ marginTop: 8 }}>
              + Add custom domain sender
            </button>
          )}

          {/* ── Sender wizard ── */}
          {wizardPhase !== 'closed' && (
            <div className={styles.wizard} ref={wizardRef}>
              <div className={styles.wizardHeader}>
                <span className={styles.wizardTitle}>
                  {wizardPhase === 'form' && 'Register sender'}
                  {wizardPhase === 'dns' && `Configure DNS for ${wizardDomain}`}
                  {wizardPhase === 'done' && 'Sender verified'}
                </span>
                <button type="button" className={styles.ghostBtn} onClick={closeWizard} aria-label="Close wizard">✕</button>
              </div>

              {wizardError && (
                <div className={styles.error} role="alert">{wizardError}</div>
              )}

              {/* Step 1: Form */}
              {wizardPhase === 'form' && (
                <form className={styles.form} onSubmit={handleRegisterSender}>
                  <label>
                    From address
                    <input
                      name="address"
                      type="email"
                      required
                      placeholder="hello@mail.yourdomain.com"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Display name
                    <input name="displayName" placeholder="Your Brand Notifications" />
                  </label>
                  <label>
                    Reply-to <span className={styles.optional}>(optional)</span>
                    <input name="replyTo" type="email" placeholder="support@yourdomain.com" />
                  </label>
                  <p className={styles.help}>
                    The domain is extracted from the from address. You will configure DNS records in the next step.
                  </p>
                  <button className={styles.primary} disabled={busy === 'sender'}>
                    {busy === 'sender' ? 'Registering…' : 'Register sender →'}
                  </button>
                </form>
              )}

              {/* Step 2: DNS configuration */}
              {wizardPhase === 'dns' && (
                <div className={styles.wizardDns}>
                  <p className={styles.help}>
                    Add these DNS records to <strong>{wizardDomain}</strong>, then click Verify. DKIM must be obtained from your Resend domain settings.
                  </p>

                  {/* Mode tabs */}
                  <div className={styles.modeTabs} role="tablist">
                    {cfAvailable && (
                      <button
                        role="tab"
                        aria-selected={dnsMode === 'cloudflare'}
                        className={dnsMode === 'cloudflare' ? styles.modeTabActive : styles.modeTab}
                        onClick={() => setDnsMode('cloudflare')}
                        type="button"
                      >
                        Cloudflare (auto)
                      </button>
                    )}
                    <button
                      role="tab"
                      aria-selected={dnsMode === 'manual'}
                      className={dnsMode === 'manual' ? styles.modeTabActive : styles.modeTab}
                      onClick={() => setDnsMode('manual')}
                      type="button"
                    >
                      Manual DNS
                    </button>
                  </div>

                  {/* Cloudflare tab */}
                  {dnsMode === 'cloudflare' && cfAvailable && (
                    <div className={styles.cfPane}>
                      {!cfProvisioned ? (
                        <>
                          <p className={styles.help}>
                            SPF, DMARC, and return-path MX will be created automatically in your Cloudflare zone.
                            You still need to add the DKIM record from Resend manually.
                          </p>
                          <button
                            type="button"
                            className={styles.cfBtn}
                            disabled={busy === 'cfconfigure'}
                            onClick={handleCloudflareConfigure}
                          >
                            {busy === 'cfconfigure' ? 'Configuring…' : '⚡ Configure DNS via Cloudflare'}
                          </button>
                        </>
                      ) : (
                        <>
                          {cfMessage && <p className={styles.cfSuccess}>{cfMessage}</p>}
                          <div className={styles.cfResults}>
                            {cfResults.map((r) => (
                              <div key={r.name} className={styles.cfResultRow}>
                                <span className={r.ok ? styles.iconOk : styles.iconFail}>
                                  {r.ok ? '✓' : '✗'}
                                </span>
                                <span className={styles.mono}>{r.name}</span>
                                <span className={styles.cfAction}>{r.action ?? ''}</span>
                              </div>
                            ))}
                          </div>
                          <DnsRecordTable records={wizardDnsRecords} cfResults={cfResults} />
                        </>
                      )}
                    </div>
                  )}

                  {/* Manual tab */}
                  {dnsMode === 'manual' && (
                    <DnsRecordTable records={wizardDnsRecords} cfResults={cfResults} verifyResult={wizardVerifyResult} />
                  )}

                  {/* Verify button + result */}
                  <div className={styles.verifyRow}>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy === 'verify'}
                      onClick={handleVerify}
                    >
                      {busy === 'verify' ? 'Verifying…' : 'Verify DNS now'}
                    </button>
                    {wizardVerifyResult && wizardVerifyResult.verificationStatus !== 'VERIFIED' && (
                      <div className={styles.verifyDetails}>
                        <span>SPF: <strong>{wizardVerifyResult.spfOk ? '✓' : 'pending'}</strong></span>
                        <span>DMARC: <strong>{wizardVerifyResult.dmarcOk ? '✓' : 'pending'}</strong></span>
                        {wizardVerifyResult.providerChecked && (
                          <span>Resend: <strong>{wizardVerifyResult.providerOk ? '✓' : 'pending'}</strong></span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Done */}
              {wizardPhase === 'done' && (
                <div className={styles.wizardDone}>
                  <p className={styles.doneIcon}>✓</p>
                  <strong>Sender verified and ready</strong>
                  <p className={styles.help}>
                    <strong>{wizardDomain}</strong> is verified and set as your default sending identity.
                    Transactional and marketing emails will use this sender.
                  </p>
                  <button type="button" className={styles.primary} onClick={closeWizard}>Done</button>
                </div>
              )}
            </div>
          )}
        </article>

        {/* ── Organization suppressions ───────────────────── */}
        <article className={styles.panel}>
          <h3>Organization suppressions</h3>
          <p className={styles.help}>These controls cannot alter inherited tenant or platform suppression state.</p>
          <form className={styles.form} onSubmit={createSuppression}>
            <label>Recipient<input name="recipientKey" required placeholder="person@example.com" /></label>
            <div className={styles.row}>
              <label>Channel
                <select name="channel" defaultValue="email">
                  <option>email</option><option>sms</option><option>whatsapp</option>
                  <option>voice</option><option>push</option><option>rcs</option>
                </select>
              </label>
              <label>Reason
                <select name="reason" defaultValue="OPT_OUT">
                  <option>OPT_OUT</option><option>UNSUBSCRIBE</option><option>BOUNCE</option>
                  <option>COMPLAINT</option><option>LEGAL_HOLD</option>
                </select>
              </label>
            </div>
            <button className={styles.primary} disabled={busy === 'suppression'}>
              {busy === 'suppression' ? 'Saving…' : 'Add suppression'}
            </button>
          </form>
          <div className={styles.list}>
            {suppressions.map((item) => (
              <div className={styles.item} key={item.suppressionId}>
                <div>
                  <strong>{item.recipientKey}</strong>
                  <small>{item.channel} · {item.reason}</small>
                </div>
                <button
                  className={styles.secondary}
                  disabled={busy === item.suppressionId}
                  onClick={() => revokeSuppression(item.suppressionId)}
                >
                  Revoke
                </button>
              </div>
            ))}
            {suppressions.length === 0 && <p className={styles.empty}>No active organization suppressions.</p>}
          </div>
        </article>
      </div>
    </section>
  );
}
