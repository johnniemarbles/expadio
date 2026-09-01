'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CourseActions({ courseId, version, canPublish }: { courseId: string; version: number; canPublish: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canPublish) return null;

  async function publish() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/learning/courses/${courseId}/publish`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Publish failed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publish failed.');
    } finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} onClick={() => void publish()}>{busy ? 'Publishing…' : `Publish version ${version}`}</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
