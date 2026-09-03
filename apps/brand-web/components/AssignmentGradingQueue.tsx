'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LearningAssignmentSubmission } from '@expadio/postgres-runtime/learning-assignment';

export function AssignmentGradingQueue({ submissions }: { submissions: readonly LearningAssignmentSubmission[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { score: string; feedback: string }>>({});
  const [error, setError] = useState<string | null>(null);

  function draft(id: string) {
    return drafts[id] ?? { score: '', feedback: '' };
  }

  async function grade(submission: LearningAssignmentSubmission, outcome: 'RETURNED' | 'GRADED') {
    const value = draft(submission.submissionId);
    setBusyId(submission.submissionId); setError(null);
    try {
      const response = await fetch(`/api/learning/assignments/submissions/${submission.submissionId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome,
          feedback: value.feedback,
          ...(outcome === 'GRADED' ? { scorePoints: Number(value.score) } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'LEARNING_ASSIGNMENT_GRADE_FAILED');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'LEARNING_ASSIGNMENT_GRADE_FAILED');
    } finally {
      setBusyId(null);
    }
  }

  if (submissions.length === 0) return <div className="empty">No assignment submissions are waiting for review.</div>;

  return <div className="gradingQueue">
    {error ? <p role="alert">{error}</p> : null}
    {submissions.map((submission) => {
      const value = draft(submission.submissionId);
      const editable = submission.status === 'SUBMITTED' || submission.status === 'RETURNED';
      return <article key={submission.submissionId}>
        <header><div><strong>{submission.title}</strong><p>{submission.assignmentKey} · attempt {submission.attemptNumber}</p></div><span>{submission.status}</span></header>
        <div className="submissionResponse">{submission.responseText || 'Attachment-only submission'}</div>
        {submission.feedback ? <p><strong>Feedback:</strong> {submission.feedback}</p> : null}
        {editable ? <div className="gradeControls">
          <label>Score<input type="number" min="0" max={submission.maxPoints} step="0.01" value={value.score} onChange={(event) => setDrafts((current) => ({ ...current, [submission.submissionId]: { ...value, score: event.target.value } }))} /></label>
          <label>Feedback<textarea value={value.feedback} onChange={(event) => setDrafts((current) => ({ ...current, [submission.submissionId]: { ...value, feedback: event.target.value } }))} /></label>
          <div><button type="button" disabled={busyId !== null || value.feedback.trim() === ''} onClick={() => void grade(submission, 'RETURNED')}>Return for revision</button>
          <button type="button" disabled={busyId !== null || value.score === ''} onClick={() => void grade(submission, 'GRADED')}>{busyId === submission.submissionId ? 'Saving…' : 'Save grade'}</button></div>
        </div> : null}
      </article>;
    })}
  </div>;
}
