'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SubmitResponse {
  readonly error?: string;
  readonly reasonKey?: string;
}

export function DraftSubmitReviewAction({
  verticalKey,
  version,
}: {
  readonly verticalKey: string;
  readonly version: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitForReview = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/configuration/industry-packs/drafts/${encodeURIComponent(verticalKey)}/${version}/submit`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null) as SubmitResponse | null;

      if (!response.ok) {
        setError(payload?.error ?? 'Industry Pack could not be submitted for review.');
        return;
      }

      router.push(`/configuration/industry-packs?vertical=${encodeURIComponent(verticalKey)}`);
      router.refresh();
    } catch {
      setError('Industry Pack could not be submitted for review. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-label="Draft lifecycle" style={{ marginTop: 16 }}>
      <button type="button" disabled={submitting} onClick={submitForReview}>
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>
      {error ? (
        <span role="alert" style={{ marginLeft: 10, color: '#b91c1c', fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </section>
  );
}
