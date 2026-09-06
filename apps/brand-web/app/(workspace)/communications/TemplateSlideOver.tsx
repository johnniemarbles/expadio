'use client';

import { FormEvent, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';

interface TemplateSlideOverProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated?: () => void;
}

export function TemplateSlideOver({ isOpen, onClose, onCreated }: TemplateSlideOverProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch('/api/communications/templates', {
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
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to create template');

      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Template creation failed');
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
          maxWidth: 600,
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
              TEMPLATE DRAFT AUTHORING
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
              Create Notification Template Draft
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
            Trigger Key *
            <input
              name="triggerKey"
              required
              placeholder="e.g. order.confirmation or auth.magic_link"
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
              Channel
              <select
                name="channel"
                defaultValue="email"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                  background: 'var(--background, #000000)',
                  color: 'var(--foreground, #FAFAFA)',
                  fontSize: 13,
                }}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="voice">Voice</option>
                <option value="push">Push Notification</option>
                <option value="rcs">RCS</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Format
              <select
                name="contentFormat"
                defaultValue="TEXT"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                  background: 'var(--background, #000000)',
                  color: 'var(--foreground, #FAFAFA)',
                  fontSize: 13,
                }}
              >
                <option value="TEXT">Plain Text</option>
                <option value="HTML">HTML</option>
                <option value="MARKDOWN">Markdown</option>
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Subject Line (Optional for non-email)
            <input
              name="subject"
              placeholder="e.g. Your Expadio Verification Code"
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
            Template Body *
            <textarea
              name="body"
              required
              rows={6}
              placeholder="Enter template body. Variables like {{code}} or {{userName}} will be interpolated..."
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
                background: 'var(--background, #000000)',
                color: 'var(--foreground, #FAFAFA)',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </label>

          <p style={{ fontSize: 12, color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
            Templates created here remain in DRAFT status until explicitly published by an authorized administrator.
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
            {busy ? 'Saving Draft...' : 'Create Template Draft →'}
          </button>
        </form>
      </MotionDrawer>
    </>
  );
}
