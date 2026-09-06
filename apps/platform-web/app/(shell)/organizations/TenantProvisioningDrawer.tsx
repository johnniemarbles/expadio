'use client';

import { FormEvent, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';

interface TenantProvisioningDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onProvisioned?: () => void;
}

export function TenantProvisioningDrawer({
  isOpen,
  onClose,
  onProvisioned,
}: TenantProvisioningDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch('/api/platform/organizations/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') || ''),
          slug: String(form.get('slug') || ''),
          planTier: String(form.get('planTier') || 'ENTERPRISE'),
          modules: ['leads', 'learning', 'communications', 'brain'],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Tenant provisioning failed');

      onProvisioned?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provisioning failed');
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
          background: 'var(--theme-surface)',
          borderLeft: '1px solid var(--theme-border)',
          borderRadius: 'var(--theme-radius-card) 0 0 var(--theme-radius-card)',
          boxShadow: 'var(--theme-shadow-subtle)',
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
            borderBottom: '1px solid var(--theme-border)',
            background: 'var(--theme-surface-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--theme-primary)',
              }}
            >
              TENANT PROVISIONING ENGINE
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--theme-text-primary)' }}>
              Provision Tenant Organization
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-card)',
              color: 'var(--theme-text-muted)',
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
              borderRadius: 'var(--theme-radius-card)',
              background: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)',
              border: '1px solid var(--theme-danger)',
              color: 'var(--theme-danger)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Organization Name *
            <input
              name="name"
              required
              placeholder="e.g. Acme Global Industries"
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--theme-radius-card)',
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface-muted)',
                color: 'var(--theme-text-primary)',
                fontSize: 13,
              }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Tenant Handle / Slug *
              <input
                name="slug"
                required
                placeholder="acme-global"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--theme-radius-card)',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-muted)',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Subscription Tier Blueprint
              <select
                name="planTier"
                defaultValue="ENTERPRISE"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--theme-radius-card)',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-muted)',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                }}
              >
                <option value="ENTERPRISE">Enterprise Multi-Entity</option>
                <option value="GROWTH">Growth Workspace</option>
                <option value="STARTER">Starter Workspace</option>
              </select>
            </label>
          </div>

          <p style={{ fontSize: 12, color: 'var(--theme-text-muted)', margin: 0 }}>
            Provisioning initializes the isolated PostgreSQL schema partition, RBAC roles, product module entitlements, and default branding configurations.
          </p>

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 12,
              height: 40,
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 'var(--theme-radius-card)',
              background: 'var(--theme-primary)',
              color: 'var(--theme-surface)',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Provisioning Tenant...' : 'Provision Tenant →'}
          </button>
        </form>
      </MotionDrawer>
    </>
  );
}
