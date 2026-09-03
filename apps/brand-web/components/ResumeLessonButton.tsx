'use client';

import { useState } from 'react';

export function ResumeLessonButton({
  enrollmentId,
  lessonId,
  blockId,
  position,
  label,
}: {
  enrollmentId: string;
  lessonId: string;
  blockId: string;
  position: number;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/learning/progress/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, lessonId, blockId, position }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'LEARNING_RESUME_FAILED');
      document.getElementById(`lesson-block-${blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'LEARNING_RESUME_FAILED');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void resume()}>{busy ? 'Opening…' : label}</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
