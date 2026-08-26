'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{ padding: '2.5rem', textAlign: 'center' }}>
      <h2 style={{ color: 'var(--red)', marginBottom: '0.75rem' }}>Something went wrong</h2>
      <p style={{ color: 'var(--ink-600)', marginBottom: '1.5rem' }}>Failed to load this Company Brain section.</p>
      {error.digest && <p style={{ color: 'var(--ink-500)', fontSize: 11, marginBottom: '1rem' }}>Correlation ID: {error.digest}</p>}
      <button onClick={() => reset()} style={{ padding: '0.5rem 1rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
        Try again
      </button>
    </div>
  );
}
