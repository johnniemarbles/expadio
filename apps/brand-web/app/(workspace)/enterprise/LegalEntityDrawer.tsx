'use client';

import { FormEvent, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';

interface LegalEntityDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onOnboarded?: () => void;
}

export function LegalEntityDrawer({ isOpen, onClose, onOnboarded }: LegalEntityDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch('/api/enterprise/legal-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: String(form.get('legalName') || ''),
          entityType: String(form.get('entityType') || 'CORPORATION'),
          countryCode: String(form.get('countryCode') || 'US'),
          subdivisionCode: String(form.get('subdivisionCode') || '') || undefined,
          taxId: String(form.get('taxId') || '') || undefined,
          registrationNumber: String(form.get('registrationNumber') || '') || undefined,
          bindingRole: String(form.get('bindingRole') || 'OPERATING_ENTITY'),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Legal entity onboarding failed');

      onOnboarded?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Legal entity onboarding failed');
    } finally {
      setBusy(false);
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
              GOVERNED STRUCTURE ONBOARDING
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
              Onboard Legal Entity
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

        <form onSubmit={handleSubmit} style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Legal Corporate Name *
            <input
              name="legalName"
              required
              placeholder="e.g. Expadio Enterprise Inc."
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Entity Type
              <select
                name="entityType"
                defaultValue="CORPORATION"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                  background: 'var(--background, #000000)',
                  color: 'var(--foreground, #FAFAFA)',
                  fontSize: 13,
                }}
              >
                <option value="CORPORATION">Corporation (C-Corp / Inc)</option>
                <option value="LLC">Limited Liability Co (LLC)</option>
                <option value="SUBSIDIARY">Subsidiary Entity</option>
                <option value="PARTNERSHIP">Partnership</option>
                <option value="SOLE_PROPRIETORSHIP">Sole Proprietorship</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Operating Binding Role
              <select
                name="bindingRole"
                defaultValue="OPERATING_ENTITY"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                  background: 'var(--background, #000000)',
                  color: 'var(--foreground, #FAFAFA)',
                  fontSize: 13,
                }}
              >
                <option value="OPERATING_ENTITY">Operating Entity</option>
                <option value="PARENT_HOLDING">Parent Holding Entity</option>
                <option value="CONTRACTING_ENTITY">Contracting Entity</option>
                <option value="REGULATORY_HOLDER">Regulatory License Holder</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Country Code *
              <input
                name="countryCode"
                required
                defaultValue="US"
                placeholder="US, GB, DE, IN, CA..."
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
              State / Region Code (Optional)
              <input
                name="subdivisionCode"
                placeholder="DE, CA, NY, ON..."
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
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              EIN / Tax ID (Optional)
              <input
                name="taxId"
                placeholder="XX-XXXXXXX"
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
              Registration Number (Optional)
              <input
                name="registrationNumber"
                placeholder="State or Federal Reg #"
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
          </div>

          <p style={{ fontSize: 12, color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
            Legal entities govern commercial authority, jurisdiction appointments, and regulatory contracts across your organization hierarchy.
          </p>

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 12,
              height: 40,
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 'var(--radius-md, 4px)',
              background: 'var(--brand-primary, #FACC15)',
              color: '#000000',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Onboarding Entity...' : 'Onboard Legal Entity →'}
          </button>
        </form>
      </MotionDrawer>
    </>
  );
}
