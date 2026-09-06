'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ModuleAction.module.css';

const ACTIVATABLE = new Set(['READY_TO_ACTIVATE', 'DEACTIVATED', 'FAILED']);

export function ModuleAction({
  moduleKey,
  availability,
  accountId,
  organizationId,
  brandHref,
}: {
  moduleKey: string;
  availability: string;
  accountId: string;
  organizationId: string;
  brandHref: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ account: accountId, org: organizationId });
      const response = await fetch(
        `/api/tenant/modules/${encodeURIComponent(moduleKey)}/activate?${params}`,
        {
          method: 'POST',
          headers: { 'x-correlation-id': crypto.randomUUID() },
        },
      );
      const payload = await response.json() as { message?: string; reasonKey?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.reasonKey ?? 'Module activation failed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Module activation failed.');
    } finally {
      setBusy(false);
    }
  }

  if (availability === 'ACTIVE') {
    return brandHref
      ? <a className={styles.secondary} href={brandHref}>Open in Brand ↗</a>
      : <span className={styles.muted}>Brand app URL is not configured.</span>;
  }
  if (availability === 'PROVISIONING') return <span className={styles.muted}>Provisioning…</span>;
  if (availability === 'LOCKED_BY_PLAN' || availability === 'SUSPENDED') {
    return <span className={styles.muted}>Active entitlement required</span>;
  }
  if (availability === 'UNAVAILABLE') return <span className={styles.muted}>Unavailable</span>;
  if (!ACTIVATABLE.has(availability)) return <span className={styles.muted}>{availability}</span>;
  if (moduleKey !== 'learning') return <span className={styles.muted}>Provisioner not implemented</span>;

  return (
    <div className={styles.action}>
      <button className={styles.primary} type="button" onClick={() => void activate()} disabled={busy}>
        {busy ? 'Activating…' : 'Activate module'}
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </div>
  );
}
