'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PublishResponse {
  readonly error?: string;
  readonly message?: string;
}

export function PublishIndustryPackButton({
  verticalKey,
  version,
}: {
  readonly verticalKey: string;
  readonly version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/configuration/industry-packs/reviews/${encodeURIComponent(verticalKey)}/${version}/publish`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null) as PublishResponse | null;
      if (!response.ok) {
        setError(
          payload?.error
          ?? payload?.message
          ?? 'Industry Pack could not be published.',
        );
        return;
      }
      router.refresh();
    } catch {
      setError('Industry Pack could not be published. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span>
      <button type="button" disabled={busy} onClick={publish}>
        {busy ? 'Publishing…' : 'Publish'}
      </button>
      {error ? (
        <span role="alert" style={{ display: 'block', marginTop: 4, color: '#b91c1c', fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
