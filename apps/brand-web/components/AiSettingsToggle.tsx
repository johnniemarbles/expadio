'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AiSettingsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/learning/ai/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aiFeaturesEnabled: !enabled }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'AI setting update failed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI setting update failed.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void change()}>
        {busy ? 'Updating…' : enabled ? 'Disable Learning AI' : 'Enable Learning AI'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
