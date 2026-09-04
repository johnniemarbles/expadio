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
    readonly attachments: readonly { readonly assetId: string; readonly filename: string; readonly contentType: string }[];
  };
}) {
  const router = useRouter();
  const [responseText, setResponseText] = useState(submission?.status === 'RETURNED' ? '' : '');
  const [submissionKey, setSubmissionKey] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileKeys, setFileKeys] = useState<string[]>([]);
  const [status, setStatus] = useState<'IDLE' | 'SUBMITTING' | 'SUBMITTED'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const stableKey = submissionKey || crypto.randomUUID();
    if (!submissionKey) setSubmissionKey(stableKey);
    setStatus('SUBMITTING'); setError(null);
    try {
      const attachmentAssetIds: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
          .map((byte) => byte.toString(16).padStart(2, '0')).join('');
        const target = new URL('/api/learning/assignments/attachments', window.location.origin);
        target.searchParams.set('enrollmentId', enrollmentId);
        target.searchParams.set('lessonId', lessonId);
        target.searchParams.set('assignmentKey', assignmentKey);
        const upload = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-expadio-filename': encodeURIComponent(file.name),
            'x-content-sha256': digest,
            'x-idempotency-key': fileKeys[index]!,
          },
          body: file,
        });
        const uploaded = await upload.json().catch(() => ({})) as { assetId?: string; reasonKey?: string };
        if (!upload.ok || !uploaded.assetId) throw new Error(uploaded.reasonKey ?? 'LEARNING_ATTACHMENT_UPLOAD_FAILED');
        attachmentAssetIds.push(uploaded.assetId);
      }

      const response = await fetch('/api/learning/assignments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, lessonId, assignmentKey, submissionKey: stableKey, responseText, attachmentAssetIds }),
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
        {submission.attachments.length > 0 ? <ul>{submission.attachments.map((asset) => <li key={asset.assetId}>{asset.filename}</li>)}</ul> : null}
      </section> : null}
      <label>
        <span>Your response</span>
        <textarea required={files.length === 0} maxLength={100000} value={responseText} onChange={(event) => setResponseText(event.target.value)} disabled={status !== 'IDLE' || awaitingReview || graded} />
      </label>
      <label>
        <span>Files (optional, up to 5 files / 25 MiB each)</span>
        <input type="file" multiple disabled={status !== 'IDLE' || awaitingReview || graded}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).slice(0, 5);
            setFiles(selected);
            setFileKeys(selected.map(() => crypto.randomUUID()));
          }} />
      </label>
      <button type="submit" disabled={status !== 'IDLE' || (responseText.trim() === '' && files.length === 0) || awaitingReview || graded}>
        {status === 'SUBMITTING' ? 'Submitting…' : status === 'SUBMITTED' ? 'Submitted' : 'Submit assignment'}
      </button>
      <div role="status" aria-live="polite">{status === 'SUBMITTED' ? 'Your work was submitted for review.' : ''}</div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
