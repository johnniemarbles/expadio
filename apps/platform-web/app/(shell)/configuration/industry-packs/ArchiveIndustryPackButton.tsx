'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ArchiveResponse {
  readonly error?: string;
}

export function ArchiveIndustryPackButton({
  verticalKey,
  version,
}: {
  readonly verticalKey: string;
  readonly version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/configuration/industry-packs/versions/${encodeURIComponent(verticalKey)}/${version}/archive`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null) as ArchiveResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? 'Industry Pack could not be archived.');
        return;
      }
      router.refresh();
    } catch {
      setError('Industry Pack could not be archived. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span>
      <button type="button" disabled={busy} onClick={archive}>
        {busy ? 'Archiving…' : 'Archive'}
      </button>
      {error ? (
        <span role="alert" style={{ display: 'block', marginTop: 4, color: '#b91c1c', fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
