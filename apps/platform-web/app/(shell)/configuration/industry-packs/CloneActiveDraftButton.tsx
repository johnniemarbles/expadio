'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface CloneActiveDraftResponse {
  readonly draft?: {
    readonly identity?: {
      readonly verticalKey?: string;
      readonly version?: number;
    };
  };
  readonly error?: string;
  readonly message?: string;
}

function apiError(data: CloneActiveDraftResponse, fallback: string): string {
  if (typeof data.error === 'string') return data.error;
  if (typeof data.message === 'string') return data.message;
  return fallback;
}

export function CloneActiveDraftButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(
        '/api/configuration/industry-packs/drafts/clone-active',
        { method: 'POST' },
      );
      const data = await response.json() as CloneActiveDraftResponse;

      if (!response.ok) {
        throw new Error(apiError(data, 'Could not create an Industry Pack draft.'));
      }

      const version = data.draft?.identity?.version;
      setMessage(
        version === undefined
          ? 'Draft created from the active Pack.'
          : `Draft v${version} created from the active Pack.`,
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create an Industry Pack draft.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={createDraft}
        disabled={busy}
        style={{
          border: 'none',
          borderRadius: "var(--theme-radius-card)",
          padding: '8px 12px',
          background: 'var(--brand)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Creating draft…' : 'Create draft from active Pack'}
      </button>
      {message !== null ? (
        <span role="status" style={{ color: 'var(--ink-600)', fontSize: 12 }}>{message}</span>
      ) : null}
      {error !== null ? (
        <span role="alert" style={{ color: '#b91c1c', fontSize: 12, maxWidth: 320, textAlign: 'right' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
