'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CompleteLessonButton({
  enrollmentId,
  lessonId,
}: {
  enrollmentId: string;
  lessonId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/learning/progress/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enrollmentId, lessonId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Lesson completion failed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lesson completion failed.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void complete()}>{busy ? 'Saving…' : 'Mark complete'}</button>
      {error ? <div className="aiError" role="alert">{error}</div> : null}
    </div>
  );
}
