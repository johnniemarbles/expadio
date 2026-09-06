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
          background: 'color-mix(in srgb, var(--background) 75%, transparent)',
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
          background: 'var(--card)',
          borderLeft: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl) 0 0 var(--radius-xl)',
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
            borderBottom: '1px solid var(--border)',
            background: 'var(--background)',
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
                color: 'var(--brand-primary)',
              }}
            >
              TEMPLATE DRAFT AUTHORING
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
              Create Notification Template Draft
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--muted-foreground)',
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
              borderRadius: 'var(--radius-md)',
              background: 'color-mix(in srgb, var(--theme-danger, var(--brand-primary)) 10%, transparent)',
              border: '1px solid var(--theme-danger, var(--brand-primary))',
              color: 'var(--theme-danger, var(--brand-primary))',
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
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
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
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
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
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
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
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
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
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </label>

          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
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
              borderRadius: 'var(--radius-md)',
              background: 'var(--brand-primary)',
              color: 'var(--card)',
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
