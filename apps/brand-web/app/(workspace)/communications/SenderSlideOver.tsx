'use client';

import { FormEvent, useEffect, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';

export type DnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number;
  purpose: string;
  verifiable?: boolean;
};

export type CfRecordResult = {
  name: string;
  ok: boolean;
  action?: string;
  detail: string;
};

export type VerifyResult = {
  spfOk: boolean;
  dmarcOk: boolean;
  providerChecked: boolean;
  providerOk: boolean;
  verificationStatus: string;
  dnsVerified: boolean;
};

type WizardPhase = 'form' | 'dns' | 'done';
type DnsMode = 'cloudflare' | 'manual';

interface SenderSlideOverProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRegistered?: () => void;
}

export function SenderSlideOver({ isOpen, onClose, onRegistered }: SenderSlideOverProps) {
  const [phase, setPhase] = useState<WizardPhase>('form');
  const [dnsMode, setDnsMode] = useState<DnsMode>('manual');
  const [cfAvailable, setCfAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [senderId, setSenderId] = useState('');
  const [domain, setDomain] = useState('');
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [cfResults, setCfResults] = useState<CfRecordResult[]>([]);
  const [cfProvisioned, setCfProvisioned] = useState(false);
  const [cfMessage, setCfMessage] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPhase('form');
      setError(null);
      return;
    }

    fetch('/api/communications/domains/cloudflare', { cache: 'no-store' })
      .then((res) => res.json())
      .then((d) => {
        const available = d?.connectorAvailable === true;
        setCfAvailable(available);
        if (available) setDnsMode('cloudflare');
      })
      .catch(() => setCfAvailable(false));
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy('register');

    const form = new FormData(e.currentTarget);
    const address = String(form.get('address') || '').trim().toLowerCase();
    const displayName = String(form.get('displayName') || '').trim() || undefined;
    const replyTo = String(form.get('replyTo') || '').trim() || undefined;
    const extractedDomain = address.includes('@') ? address.split('@')[1] ?? '' : '';

    try {
      const res = await fetch('/api/communications/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: extractedDomain,
          address,
          displayName,
          replyTo,
          purposes: ['transactional'],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to register sender');

      const sId = data?.sender?.sender_id ?? data?.sender?.senderId ?? '';
      const records: DnsRecord[] = [
        { type: 'TXT', name: extractedDomain, value: 'v=spf1 include:amazonses.com include:_spf.resend.com ~all', purpose: 'SPF', verifiable: true },
        { type: 'TXT', name: `_dmarc.${extractedDomain}`, value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${extractedDomain}`, purpose: 'DMARC', verifiable: true },
        { type: 'MX', name: `mail.${extractedDomain}`, value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, purpose: 'Return-path (MX)', verifiable: true },
        { type: 'TXT', name: `resend._domainkey.${extractedDomain}`, value: 'Issued by Resend — add DKIM key from provider panel', purpose: 'DKIM', verifiable: false },
      ];

      setSenderId(sId);
      setDomain(extractedDomain);
      setDnsRecords(records);
      setPhase('dns');
      onRegistered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleCloudflareConfigure() {
    setError(null);
    setBusy('cf');
    try {
      const res = await fetch('/api/communications/domains/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Cloudflare setup failed');

      setCfProvisioned(data.provisioned === true);
      setCfResults(Array.isArray(data.cloudflare) ? data.cloudflare : []);
      setCfMessage(data.message ?? '');
      if (Array.isArray(data.records)) setDnsRecords(data.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cloudflare configuration failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleVerify() {
    setError(null);
    setBusy('verify');
    try {
      const res = await fetch(`/api/communications/senders/${encodeURIComponent(senderId)}/verify`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Verification check failed');

      const vRes: VerifyResult = {
        spfOk: data.spfOk ?? false,
        dmarcOk: data.dmarcOk ?? false,
        providerChecked: data.providerChecked ?? false,
        providerOk: data.providerOk ?? false,
        verificationStatus: data.verificationStatus ?? 'PENDING',
        dnsVerified: data.dnsVerified ?? false,
      };

      setVerifyResult(vRes);
      if (vRes.verificationStatus === 'VERIFIED') {
        setPhase('done');
      }
      onRegistered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 99,
        }}
      />

      <MotionDrawer
        open={isOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--card, #0A0A0A)',
          borderLeft: '1px solid var(--border, #272727)',
          borderRadius: 'var(--radius-xl, 8px) 0 0 var(--radius-xl, 8px)',
          boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border, #272727)',
            background: 'var(--background, #000000)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--brand-primary, #FACC15)',
              }}
            >
              IDENTITY ONBOARDING
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
              {phase === 'form' && 'Register Sending Identity'}
              {phase === 'dns' && `DNS Configuration · ${domain}`}
              {phase === 'done' && 'Sender Identity Verified'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 4px)',
              color: 'var(--muted-foreground, #A1A1AA)',
              fontSize: 16,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              margin: '16px 24px 0',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md, 4px)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #EF4444',
              color: '#F87171',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
          {phase === 'form' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                From Email Address *
                <input
                  name="address"
                  type="email"
                  required
                  placeholder="notifications@mail.yourdomain.com"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--background, #000000)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Display Name
                <input
                  name="displayName"
                  placeholder="e.g. Acme Support Team"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--background, #000000)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Reply-To Address (Optional)
                <input
                  name="replyTo"
                  type="email"
                  placeholder="support@yourdomain.com"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--background, #000000)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                />
              </label>

              <p style={{ fontSize: 12, color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
                Registering a custom domain identity creates the required DNS records (SPF, DMARC, Return-path MX) for verification in the next step.
              </p>

              <button
                type="submit"
                disabled={busy === 'register'}
                style={{
                  marginTop: 12,
                  height: 40,
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 'var(--radius-md, 4px)',
                  background: 'var(--brand-primary, #FACC15)',
                  color: '#000000',
                  border: 'none',
                  cursor: busy === 'register' ? 'not-allowed' : 'pointer',
                }}
              >
                {busy === 'register' ? 'Registering...' : 'Register Sender & Next →'}
              </button>
            </form>
          )}

          {phase === 'dns' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border, #272727)', paddingBottom: 8 }}>
                {cfAvailable && (
                  <button
                    type="button"
                    onClick={() => setDnsMode('cloudflare')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: dnsMode === 'cloudflare' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                      color: dnsMode === 'cloudflare' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    ⚡ Cloudflare Auto
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDnsMode('manual')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    background: dnsMode === 'manual' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                    color: dnsMode === 'manual' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Manual DNS Records
                </button>
              </div>

              {dnsMode === 'cloudflare' && cfAvailable ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
                    Automatically provision SPF, DMARC, and MX records in your Cloudflare DNS zone.
                  </p>
                  {!cfProvisioned ? (
                    <button
                      type="button"
                      onClick={handleCloudflareConfigure}
                      disabled={busy === 'cf'}
                      style={{
                        height: 38,
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 4,
                        background: 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)',
                        border: '1px solid var(--brand-primary, #FACC15)',
                        color: 'var(--brand-primary, #FACC15)',
                        cursor: busy === 'cf' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy === 'cf' ? 'Provisioning...' : '⚡ Auto-provision DNS via Cloudflare'}
                    </button>
                  ) : (
                    <div style={{ fontSize: 13, color: '#22C55E' }}>✓ {cfMessage || 'Cloudflare DNS configured successfully!'}</div>
                  )}
                </div>
              ) : null}

              {/* Records Table */}
              <div style={{ background: 'var(--background, #000000)', borderRadius: 6, border: '1px solid var(--border, #272727)', overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--card, #0A0A0A)', borderBottom: '1px solid var(--border, #272727)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Purpose</th>
                      <th style={{ padding: '8px 12px' }}>Type</th>
                      <th style={{ padding: '8px 12px' }}>Host</th>
                      <th style={{ padding: '8px 12px' }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsRecords.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border, #171717)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--brand-primary, #FACC15)' }}>{r.purpose}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{r.type}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{r.name}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--muted-foreground, #A1A1AA)' }}>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={handleVerify}
                disabled={busy === 'verify'}
                style={{
                  marginTop: 12,
                  height: 40,
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 'var(--radius-md, 4px)',
                  background: 'var(--brand-primary, #FACC15)',
                  color: '#000000',
                  border: 'none',
                  cursor: busy === 'verify' ? 'not-allowed' : 'pointer',
                }}
              >
                {busy === 'verify' ? 'Verifying DNS...' : 'Verify DNS Records Now'}
              </button>

              {verifyResult && verifyResult.verificationStatus !== 'VERIFIED' && (
                <div style={{ padding: 12, borderRadius: 4, background: 'var(--card, #0A0A0A)', border: '1px solid var(--border, #272727)', fontSize: 12 }}>
                  <div>SPF Check: <strong>{verifyResult.spfOk ? '✓ Pass' : 'Pending propagation'}</strong></div>
                  <div>DMARC Check: <strong>{verifyResult.dmarcOk ? '✓ Pass' : 'Pending propagation'}</strong></div>
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, paddingTop: 40 }}>
              <div style={{ fontSize: 36, color: '#22C55E' }}>✓</div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>Sender Identity Active</h3>
              <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', maxWidth: 400 }}>
                Domain <strong>{domain}</strong> is verified. You can now send governed transactional and marketing communications from this identity.
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: 16,
                  height: 38,
                  padding: '0 24px',
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 'var(--radius-md, 4px)',
                  background: 'var(--brand-primary, #FACC15)',
                  color: '#000000',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </MotionDrawer>
    </>
  );
}
