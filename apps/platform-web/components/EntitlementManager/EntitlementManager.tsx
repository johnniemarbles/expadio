'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TenantModuleEntitlementRecord } from '@expadio/postgres-runtime/product-module';
import styles from './EntitlementManager.module.css';

const SOURCES = ['PLAN', 'ADD_ON', 'TRIAL', 'CONTRACT', 'PLATFORM_GRANT'] as const;

function displayDate(value: string | null): string {
  if (!value) return 'No expiry';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function isoFromLocal(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export function EntitlementManager({
  moduleKey,
  accountId,
  organizationId,
  entitlements,
}: {
  moduleKey: string;
  accountId: string;
  organizationId: string;
  entitlements: readonly TenantModuleEntitlementRecord[];
}) {
  const router = useRouter();
  const [sourceType, setSourceType] = useState<(typeof SOURCES)[number]>('PLATFORM_GRANT');
  const [sourceKey, setSourceKey] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = new URLSearchParams({ account: accountId, org: organizationId }).toString();

  async function grant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('grant');
    setError(null);
    try {
      const response = await fetch(
        `/api/platform/tenant/modules/${encodeURIComponent(moduleKey)}/entitlements?${query}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': crypto.randomUUID(),
          },
          body: JSON.stringify({
            sourceType,
            sourceKey,
            validFrom: isoFromLocal(validFrom),
            validUntil: isoFromLocal(validUntil) ?? null,
            note,
          }),
        },
      );
      const payload = await response.json() as { message?: string; reasonKey?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.reasonKey ?? 'Entitlement grant failed.');
      setSourceKey('');
      setValidFrom('');
      setValidUntil('');
      setNote('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Entitlement grant failed.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(entitlementId: string) {
    const reason = window.prompt('Reason for revoking this entitlement?')?.trim() ?? '';
    if (!window.confirm('Revoke this module entitlement? Effective Brand access may be suspended immediately.')) return;
    setBusy(entitlementId);
    setError(null);
    try {
      const response = await fetch(
        `/api/platform/tenant/modules/${encodeURIComponent(moduleKey)}/entitlements/${encodeURIComponent(entitlementId)}/revoke?${query}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': crypto.randomUUID(),
          },
          body: JSON.stringify({ reason }),
        },
      );
      const payload = await response.json() as { message?: string; reasonKey?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.reasonKey ?? 'Entitlement revocation failed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Entitlement revocation failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.manager} aria-label="Commercial entitlement management">
      <div className={styles.heading}>
        <div>
          <strong>Platform entitlement</strong>
          <span>Commercial control plane · tenant users cannot grant this access.</span>
        </div>
      </div>

      <form className={styles.form} onSubmit={(event) => void grant(event)}>
        <label>
          Source
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as (typeof SOURCES)[number])}>
            {SOURCES.map((source) => <option key={source} value={source}>{source.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <label>
          Source key
          <input
            required
            maxLength={160}
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
            placeholder="enterprise-2026 / contract-123 / manual-grant"
          />
        </label>
        <label>
          Valid from
          <input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
        </label>
        <label>
          Valid until
          <input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
        </label>
        <label className={styles.wide}>
          Note
          <input
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Commercial approval or contract reference"
          />
        </label>
        <div className={styles.wide}>
          <button className={styles.primary} type="submit" disabled={busy !== null}>
            {busy === 'grant' ? 'Saving…' : 'Grant / update entitlement'}
          </button>
        </div>
      </form>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.history}>
        <div className={styles.historyTitle}>Entitlement history</div>
        {entitlements.length === 0 ? (
          <div className={styles.empty}>No entitlement records yet.</div>
        ) : entitlements.map((entitlement) => (
          <div className={styles.row} key={entitlement.entitlementId}>
            <div>
              <strong>{entitlement.sourceType} · {entitlement.sourceKey}</strong>
              <span>{displayDate(entitlement.validFrom)} → {displayDate(entitlement.validUntil)}</span>
            </div>
            <div className={styles.rowActions}>
              <span className={styles.state}>{entitlement.effectiveState}</span>
              {entitlement.effectiveState === 'ACTIVE' || entitlement.effectiveState === 'SCHEDULED' ? (
                <button
                  type="button"
                  className={styles.revoke}
                  disabled={busy !== null}
                  onClick={() => void revoke(entitlement.entitlementId)}
                >
                  {busy === entitlement.entitlementId ? 'Revoking…' : 'Revoke'}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
