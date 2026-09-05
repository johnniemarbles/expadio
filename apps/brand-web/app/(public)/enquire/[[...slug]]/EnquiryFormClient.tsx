'use client';

import { useCallback, useState } from 'react';
import { createBrowserCaptureClient } from '@expadio/lead-capture';

const INTEREST_LABELS: Record<string, string> = {
  'FRANCHISEE:SINGLE_UNIT': 'Single unit franchise',
  'FRANCHISEE:MULTI_UNIT': 'Multi-unit franchise',
  'FRANCHISEE:AREA_DEVELOPMENT': 'Area development',
  'FRANCHISEE:CONVERSION': 'Conversion franchise',
  'FRANCHISEE:RESALE': 'Resale franchise',
  'MASTER_FRANCHISEE': 'Master franchise',
  'DISTRIBUTOR:EXCLUSIVE_DISTRIBUTOR': 'Exclusive distributor',
  'DISTRIBUTOR:NON_EXCLUSIVE_DISTRIBUTOR': 'Non-exclusive distributor',
  'DISTRIBUTOR:MASTER_DISTRIBUTOR': 'Master distributor',
  'DISTRIBUTOR:SUB_DISTRIBUTOR': 'Sub-distributor',
  'AFFILIATE': 'Affiliate partnership',
  'LICENSEE': 'Licensing',
  'AGENT': 'Sales agent',
};

interface PublicationOption {
  publicationId: string;
  interestType: string;
  opportunityType: string | null;
  publicationSlug: string | null;
  captureSourceId: string;
  publishableKey: string;
}

interface Props {
  tenantId: string;
  organizationId: string;
  brandDisplayName: string | null;
  organizationName: string;
  sourceId: string;
  publishableKey: string;
  interestType: string;
  opportunityType: string | null;
  platformWebUrl: string;
  publications: PublicationOption[];
  selectedPublicationId: string;
}

type FormState = 'idle' | 'submitting' | 'verify' | 'done' | 'error';

function interestKey(interestType: string, opportunityType: string | null): string {
  return opportunityType ? `${interestType}:${opportunityType}` : interestType;
}

export default function EnquiryFormClient({
  tenantId,
  brandDisplayName,
  organizationName,
  sourceId,
  publishableKey,
  interestType,
  opportunityType,
  platformWebUrl,
  publications,
  selectedPublicationId,
}: Props) {
  const displayName = brandDisplayName || organizationName;

  const [selectedPubId, setSelectedPubId] = useState(selectedPublicationId);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captureLeadId, setCaptureLeadId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Resolve active publication's source details
  const activePub = publications.find((p) => p.publicationId === selectedPubId) ?? publications[0];
  const activeSourceId = activePub?.captureSourceId ?? sourceId;
  const activeKey = activePub?.publishableKey ?? publishableKey;
  const activeInterest = activePub?.interestType ?? interestType;
  const activeOpportunity = activePub?.opportunityType ?? opportunityType;

  const captureClient = useCallback(() => {
    return createBrowserCaptureClient({
      baseUrl: platformWebUrl,
      tenantId,
      sourceId: activeSourceId,
      publishableKey: activeKey,
    });
  }, [platformWebUrl, tenantId, activeSourceId, activeKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'submitting') return;
    setState('submitting');
    setError(null);

    try {
      const client = captureClient();
      const result = await client.submit({
        contact: {
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          email: email.trim(),
          phone: phone.trim() || undefined,
        },
        fields: {
          interestType: activeInterest,
          opportunityType: activeOpportunity ?? null,
          message: message.trim() || null,
        },
        consent: [{
          channel: 'EMAIL',
          purpose: 'marketing',
          granted: true,
        }],
      });

      if (result.requiresVerification && result.captureLeadId) {
        setCaptureLeadId(result.captureLeadId);
        setState('verify');
      } else {
        setState('done');
      }
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (verifying || !captureLeadId) return;
    setVerifying(true);
    setOtpError(null);

    try {
      const client = captureClient();
      const result = await client.verify(captureLeadId, otp.trim());
      if (result.verified) {
        setState('done');
      } else {
        const msg = result.reason === 'LOCKED'
          ? 'Too many attempts. Please request a new code.'
          : result.reason === 'EXPIRED'
            ? 'Code has expired. Please submit the form again.'
            : `Incorrect code. ${result.remainingAttempts !== undefined ? `${result.remainingAttempts} attempt${result.remainingAttempts !== 1 ? 's' : ''} remaining.` : ''}`;
        setOtpError(msg);
      }
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  const shell: React.CSSProperties = {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: '32px 16px',
    background: 'var(--theme-canvas)',
    color: 'var(--theme-text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 520,
    background: 'var(--theme-surface)',
    border: '1px solid var(--theme-border)',
    borderRadius: "var(--theme-radius-card)",
    padding: 32,
    boxShadow: '0 8px 32px color-mix(in srgb, var(--theme-text-primary) 8%, transparent)',
  };

  const fieldStyle: React.CSSProperties = {
    display: 'grid',
    gap: 5,
    fontSize: 13,
    fontWeight: 700,
  };

  const inputStyle: React.CSSProperties = {
    padding: '10px 12px',
    border: '1px solid var(--theme-border)',
    borderRadius: "var(--theme-radius-card)",
    background: 'var(--theme-surface)',
    color: 'var(--theme-text-primary)',
    fontSize: 14,
    fontWeight: 400,
    width: '100%',
    boxSizing: 'border-box',
  };

  const primaryBtn: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    background: 'var(--theme-primary)',
    color: 'var(--theme-primary-foreground, var(--theme-surface))',
    border: 'none',
    borderRadius: "var(--theme-radius-card)",
    fontSize: 14,
    fontWeight: 750,
    cursor: 'pointer',
    marginTop: 8,
  };

  if (state === 'done') {
    return (
      <div style={shell}>
        <div style={card}>
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--theme-text-muted)' }}>
              {displayName}
            </p>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Thank you!</h1>
          </div>
          <p style={{ color: 'var(--theme-text-secondary)', lineHeight: 1.6 }}>
            Your enquiry has been received. Our team will be in touch soon.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'verify') {
    return (
      <div style={shell}>
        <div style={card}>
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--theme-text-muted)' }}>
              {displayName}
            </p>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Check your email</h1>
            <p style={{ marginTop: 8, color: 'var(--theme-text-secondary)', lineHeight: 1.6 }}>
              We sent a verification code to <strong>{email}</strong>. Enter it below to confirm your enquiry.
            </p>
          </div>
          <form onSubmit={(e) => void verify(e)} style={{ display: 'grid', gap: 16 }}>
            <label style={fieldStyle}>
              Verification code
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                style={{ ...inputStyle, fontSize: 18, letterSpacing: '0.15em', textAlign: 'center' }}
                autoFocus
              />
            </label>
            {otpError ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--theme-danger)' }}>{otpError}</p>
            ) : null}
            <button type="submit" disabled={verifying || otp.trim().length < 4} style={primaryBtn}>
              {verifying ? 'Verifying…' : 'Confirm'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--theme-text-muted)' }}>
            {displayName}
          </p>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Enquire now</h1>
          <p style={{ marginTop: 8, margin: '8px 0 0', color: 'var(--theme-text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Fill in your details and we&apos;ll be in touch to discuss your interest.
          </p>
        </div>

        {/* Interest type selector — shown when the brand has multiple offerings */}
        {publications.length > 1 ? (
          <div style={{ ...fieldStyle, marginBottom: 20 }}>
            I&apos;m interested in
            <select
              value={selectedPubId}
              onChange={(e) => setSelectedPubId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {publications.map((p) => (
                <option key={p.publicationId} value={p.publicationId}>
                  {INTEREST_LABELS[interestKey(p.interestType, p.opportunityType)] ?? p.interestType}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p style={{ marginTop: 0, marginBottom: 20, fontSize: 13, color: 'var(--theme-text-secondary)' }}>
            {INTEREST_LABELS[interestKey(activeInterest, activeOpportunity)] ?? activeInterest}
          </p>
        )}

        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>
              First name
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                style={inputStyle}
                autoComplete="given-name"
              />
            </label>
            <label style={fieldStyle}>
              Last name
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                style={inputStyle}
                autoComplete="family-name"
              />
            </label>
          </div>

          <label style={fieldStyle}>
            Email <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)' }}>*</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              style={inputStyle}
              autoComplete="email"
            />
          </label>

          <label style={fieldStyle}>
            Phone
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              style={inputStyle}
              autoComplete="tel"
            />
          </label>

          <label style={fieldStyle}>
            Message <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)' }}>(optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us about your interest, timeline, or any questions you have…"
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 96 }}
            />
          </label>

          {error ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--theme-danger)' }}>{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={state === 'submitting' || !email.trim()}
            style={primaryBtn}
          >
            {state === 'submitting' ? 'Sending…' : 'Send enquiry'}
          </button>

          <p style={{ margin: 0, fontSize: 11, color: 'var(--theme-text-muted)', lineHeight: 1.5, textAlign: 'center' }}>
            By submitting you agree to be contacted about your enquiry. We won&apos;t share your details.
          </p>
        </form>
      </div>
    </div>
  );
}
