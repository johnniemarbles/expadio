'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LearnerAssignmentForm({
  enrollmentId,
  lessonId,
  assignmentKey,
  title,
  submission,
}: {
  enrollmentId: string;
  lessonId: string;
  assignmentKey: string;
  title?: string;
  submission?: {
    readonly status: 'SUBMITTED' | 'RETURNED' | 'GRADED' | 'VOID';
    readonly attemptNumber: number;
    readonly scorePoints: number | null;
    readonly maxPoints: number;
    readonly feedback: string;
    readonly submittedAt: string;
  };
}) {
  const router = useRouter();
  const [responseText, setResponseText] = useState(submission?.status === 'RETURNED' ? '' : '');
  const [submissionKey, setSubmissionKey] = useState('');
  const [status, setStatus] = useState<'IDLE' | 'SUBMITTING' | 'SUBMITTED'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const stableKey = submissionKey || crypto.randomUUID();
    if (!submissionKey) setSubmissionKey(stableKey);
    setStatus('SUBMITTING'); setError(null);
    try {
      const response = await fetch('/api/learning/assignments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, lessonId, assignmentKey, submissionKey: stableKey, responseText }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'LEARNING_ASSIGNMENT_SUBMISSION_FAILED');
      setStatus('SUBMITTED');
      router.refresh();
    } catch (cause) {
      setStatus('IDLE');
      setError(cause instanceof Error ? cause.message : 'LEARNING_ASSIGNMENT_SUBMISSION_FAILED');
    }
  }

  const awaitingReview = submission?.status === 'SUBMITTED';
  const graded = submission?.status === 'GRADED';

  return (
    <form className="assignmentForm" onSubmit={(event) => void submit(event)}>
      <strong>{title ?? 'Assignment'}</strong>
      {submission ? <section className="assignmentFeedback" aria-label="Latest submission status">
        <p><strong>{submission.status}</strong> · attempt {submission.attemptNumber} · {new Date(submission.submittedAt).toLocaleString()}</p>
        {graded ? <p>Score: {submission.scorePoints}/{submission.maxPoints}</p> : null}
        {submission.feedback ? <p><strong>Feedback:</strong> {submission.feedback}</p> : null}
      </section> : null}
      <label>
        <span>Your response</span>
        <textarea required maxLength={100000} value={responseText} onChange={(event) => setResponseText(event.target.value)} disabled={status !== 'IDLE' || awaitingReview || graded} />
      </label>
      <button type="submit" disabled={status !== 'IDLE' || responseText.trim() === '' || awaitingReview || graded}>
        {status === 'SUBMITTING' ? 'Submitting…' : status === 'SUBMITTED' ? 'Submitted' : 'Submit assignment'}
      </button>
      <div role="status" aria-live="polite">{status === 'SUBMITTED' ? 'Your work was submitted for review.' : ''}</div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
