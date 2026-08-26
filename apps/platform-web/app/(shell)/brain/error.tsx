'use client';

import { useEffect } from 'react';

export default function BrainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <h2 style={{ color: 'var(--red)', marginBottom: '1rem' }}>Something went wrong!</h2>
      <p style={{ color: 'var(--ink-600)', marginBottom: '2rem' }}>Failed to load brain data.</p>
      <button
        onClick={() => reset()}
        style={{
          padding: '0.5rem 1rem',
          background: 'var(--brand)',
          color: 'var(--surface)',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Try again
      </button>
    </div>
  );
}
