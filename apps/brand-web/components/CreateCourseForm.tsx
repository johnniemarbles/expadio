'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function CreateCourseForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [courseKey, setCourseKey] = useState('');
  const [summary, setSummary] = useState('');
  const [objective, setObjective] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonBody, setLessonBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/learning/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseKey: courseKey || slug(title), title, summary, objective,
          lessonTitle: lessonTitle || 'Introduction', lessonBody,
        }),
      });
      const payload = await response.json() as { courseId?: string; error?: string };
      if (!response.ok || !payload.courseId) throw new Error(payload.error ?? 'Course creation failed.');
      router.push(`/learning/courses/${payload.courseId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Course creation failed.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="learningForm">
      <label>Title<input value={title} onChange={(event) => { setTitle(event.target.value); if (!courseKey) setCourseKey(slug(event.target.value)); }} required /></label>
      <label>Course key<input value={courseKey} onChange={(event) => setCourseKey(event.target.value)} required /></label>
      <label className="wide">Summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
      <label className="wide">Learning objective<input value={objective} onChange={(event) => setObjective(event.target.value)} required /></label>
      <label>First lesson title<input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} /></label>
      <label className="wide">First lesson content<textarea value={lessonBody} onChange={(event) => setLessonBody(event.target.value)} required /></label>
      <div className="wide"><button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft course'}</button></div>
      {error ? <p className="wide" role="alert">{error}</p> : null}
    </form>
  );
}
