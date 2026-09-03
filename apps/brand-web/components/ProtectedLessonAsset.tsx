'use client';

import { useState } from 'react';

type AssetKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'RESOURCE';

export function ProtectedLessonAsset({
  enrollmentId,
  lessonId,
  assetId,
  kind,
  title,
  label,
}: {
  enrollmentId: string;
  lessonId: string;
  assetId: string;
  kind: AssetKind;
  title?: string;
  label?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/learning/assets/read-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, lessonId, assetId }),
      });
      const body = await response.json().catch(() => ({})) as { url?: string; expiresAt?: string; reasonKey?: string };
      if (!response.ok || !body.url) throw new Error(body.reasonKey ?? 'LEARNING_ASSET_LOAD_FAILED');
      setUrl(body.url);
      setExpiresAt(body.expiresAt ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'LEARNING_ASSET_LOAD_FAILED');
    } finally {
      setBusy(false);
    }
  }

  if (!url) return (
    <div>
      <button type="button" disabled={busy} onClick={() => void load()}>
        {busy ? 'Loading…' : `Load ${kind.toLowerCase()}`}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );

  if (kind === 'IMAGE') return <img src={url} alt={label ?? ''} />;
  if (kind === 'VIDEO') return <video controls src={url} aria-label={label ?? title ?? 'Lesson video'} />;
  if (kind === 'AUDIO') return <audio controls src={url} aria-label={label ?? title ?? 'Lesson audio'} />;
  return <p><a href={url} target="_blank" rel="noreferrer">{title ?? 'Open protected resource'}</a>{expiresAt ? ' · Link expires soon' : null}</p>;
}
