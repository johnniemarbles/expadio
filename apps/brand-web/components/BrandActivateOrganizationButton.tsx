'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../app/(workspace)/workspace.module.css';

export function BrandActivateOrganizationButton({
  setupPlanId,
  organizationName,
}: {
  setupPlanId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    if (!window.confirm(`Activate ${organizationName} for business-runtime access?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/enterprise/setup/plans/' + setupPlanId + '/activate',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'x-correlation-id': crypto.randomUUID(),
          },
          body: JSON.stringify({
            reason: 'Activated from the Brand Enterprise Hub after readiness review.',
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message ?? body.reasonKey ?? 'Activation failed.');
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Activation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className={styles.button} type="button" disabled={busy} onClick={() => void activate()}>
        {busy ? 'Activating…' : 'Activate organization'}
      </button>
      {error ? <div className="aiError" role="alert">{error}</div> : null}
    </div>
  );
}
