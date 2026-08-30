'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ReturnResponse {
  readonly error?: string;
}

export function ReturnIndustryPackToDraftButton({
  verticalKey,
  version,
}: {
  readonly verticalKey: string;
  readonly version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnToDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/configuration/industry-packs/reviews/${encodeURIComponent(verticalKey)}/${version}/return`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null) as ReturnResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? 'Industry Pack could not be returned to draft.');
        return;
      }
      router.refresh();
    } catch {
      setError('Industry Pack could not be returned to draft. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span>
      <button type="button" disabled={busy} onClick={returnToDraft}>
        {busy ? 'Returning…' : 'Return to draft'}
      </button>
      {error ? (
        <span role="alert" style={{ display: 'block', marginTop: 4, color: '#b91c1c', fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
