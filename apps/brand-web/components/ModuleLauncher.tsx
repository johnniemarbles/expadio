'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACTIVATABLE = new Set(['READY_TO_ACTIVATE', 'DEACTIVATED', 'FAILED']);

export function ModuleLauncher({
  moduleKey,
  availability,
  route,
}: {
  moduleKey: string;
  availability: string;
  route: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activateLearning() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/learning/activate', { method: 'POST' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Module activation failed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Module activation failed.');
    } finally {
      setBusy(false);
    }
  }

  if (availability === 'ACTIVE' && route) {
    return <Link className="modulePrimaryAction" href={route}>Open {moduleKey === 'learning' ? 'Learning' : 'app'}</Link>;
  }
  if (availability === 'PROVISIONING') return <span className="moduleDisabledAction">Provisioning…</span>;
  if (availability === 'LOCKED_BY_PLAN' || availability === 'SUSPENDED') {
    return <span className="moduleDisabledAction">Not included in active entitlement</span>;
  }
  if (availability === 'UNAVAILABLE') return <span className="moduleDisabledAction">Unavailable</span>;
  if (ACTIVATABLE.has(availability) && moduleKey === 'learning') {
    return <div><button type="button" disabled={busy} onClick={() => void activateLearning()}>{busy ? 'Activating…' : 'Activate Learning'}</button>{error ? <div className="aiError" role="alert">{error}</div> : null}</div>;
  }
  return <span className="moduleDisabledAction">Activation not yet available</span>;
}
