'use client';

import { useState } from 'react';

interface CourseOption { readonly courseId: string; readonly title: string; }
interface AiStatus {
  readonly learningAiRequestId: string;
  readonly jobStatus: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  readonly output?: { readonly mediaType: string; readonly content: string } | null;
  readonly confidence?: number | null;
  readonly costMinorUnits?: number | null;
  readonly lastFailureCode?: string | null;
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export function LearningAiPanel({
  admin,
  courses,
}: {
  admin: boolean;
  courses: readonly CourseOption[];
}) {
  const [requestType, setRequestType] = useState('TUTOR');
  const [courseId, setCourseId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus(id: string): Promise<AiStatus> {
    const response = await fetch(`/api/learning/ai/requests/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    const payload = await response.json() as AiStatus & { error?: string; message?: string };
    if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Learning AI status failed.');
    return payload;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch('/api/learning/ai/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestType,
          prompt,
          idempotencyKey: crypto.randomUUID(),
          ...(courseId ? { courseId } : {}),
          metadata: { surface: 'brand-learning-ui' },
        }),
      });
      const created = await response.json() as { learningAiRequestId?: string; error?: string; message?: string };
      if (!response.ok || !created.learningAiRequestId) {
        throw new Error(created.message ?? created.error ?? 'Learning AI request failed.');
      }

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const current = await loadStatus(created.learningAiRequestId);
        setStatus(current);
        if (TERMINAL.has(current.jobStatus)) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Learning AI request failed.');
    } finally { setBusy(false); }
  }

  const authorOnly = requestType === 'AUTHOR_DRAFT' || requestType === 'ASSESSMENT_FEEDBACK';

  return (
    <div>
      <form onSubmit={(event) => void submit(event)} className="learningForm">
        <label>
          Mode
          <select value={requestType} onChange={(event) => setRequestType(event.target.value)}>
            <option value="TUTOR">Tutor</option>
            <option value="COACH">Coach</option>
            {admin ? <option value="AUTHOR_DRAFT">Author draft</option> : null}
            {admin ? <option value="ASSESSMENT_FEEDBACK">Assessment feedback</option> : null}
          </select>
        </label>
        <label>
          Course context
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">No course selected</option>
            {courses.map((course) => <option key={course.courseId} value={course.courseId}>{course.title}</option>)}
          </select>
        </label>
        <label className="wide">
          {authorOnly ? 'Authoring instruction' : 'Question'}
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} required />
        </label>
        <div className="wide">
          <button type="submit" disabled={busy || prompt.trim() === ''}>
            {busy ? 'Working…' : requestType === 'TUTOR' ? 'Ask tutor' : 'Run Learning AI'}
          </button>
        </div>
      </form>

      {error ? <div className="aiError" role="alert">{error}</div> : null}
      {status ? (
        <section className="aiResult" aria-live="polite">
          <div className="aiMeta">
            <strong>{status.jobStatus}</strong>
            {status.confidence !== null && status.confidence !== undefined ? <span>Confidence {Math.round(status.confidence * 100)}%</span> : null}
            {status.costMinorUnits !== null && status.costMinorUnits !== undefined ? <span>Cost evidence {status.costMinorUnits} minor units</span> : null}
          </div>
          {status.output?.content ? <div className="aiAnswer">{status.output.content}</div> : null}
          {status.lastFailureCode ? <div className="aiError">Failure: {status.lastFailureCode}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
