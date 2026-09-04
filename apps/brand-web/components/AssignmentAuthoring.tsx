'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LearningCourseVersion } from '@expadio/postgres-runtime/learning';

export function AssignmentAuthoring({
  courseId,
  version,
}: {
  courseId: string;
  version: LearningCourseVersion;
}) {
  const router = useRouter();
  const lessons = version.modules.flatMap((module) => module.lessons);
  const [lessonId, setLessonId] = useState(lessons[0]?.lessonId ?? '');
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [maxPoints, setMaxPoints] = useState('100');
  const [dueAt, setDueAt] = useState('');
  const [allowAttachments, setAllowAttachments] = useState(false);
  const [maxAttachments, setMaxAttachments] = useState('5');
  const [status, setStatus] = useState<'IDLE' | 'CREATING' | 'SAVING_BLOCK' | 'PUBLISHING' | 'PUBLISHED'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setStatus('CREATING'); setError(null);
    try {
      const createdResponse = await fetch('/api/learning/assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseVersionId: version.courseVersionId, assignmentKey: key, title,
          instructions, maxPoints: Number(maxPoints), allowAttachments,
          maxAttachments: allowAttachments ? Number(maxAttachments) : 0,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      const created = await createdResponse.json().catch(() => ({})) as {
        assignmentId?: string; assignmentKey?: string; version?: number; error?: string;
      };
      if (!createdResponse.ok || !created.assignmentId || !created.assignmentKey) {
        throw new Error(created.error ?? 'LEARNING_ASSIGNMENT_CREATE_FAILED');
      }

      setStatus('SAVING_BLOCK');
      const draft = {
        title: version.title, summary: version.summary, description: version.description,
        language: version.language, visibility: version.visibility,
        estimatedMinutes: version.estimatedMinutes, learningObjectives: [...version.learningObjectives],
        modules: version.modules.map((module) => ({
          moduleKey: module.moduleKey, title: module.title, position: module.position,
          lessons: module.lessons.map((lesson) => {
            const raw = lesson.content as { schemaVersion?: unknown; blocks?: unknown };
            if (lesson.lessonId === lessonId && Object.keys(raw).length > 0
              && (raw.schemaVersion !== 1 || !Array.isArray(raw.blocks))) {
              throw new Error('LESSON_CONTENT_MIGRATION_REQUIRED');
            }
            const existing = lesson.lessonId === lessonId && Array.isArray(raw.blocks) ? raw.blocks : [];
            const blocks = lesson.lessonId === lessonId ? [...existing, {
              id: `assignment-${crypto.randomUUID()}`, type: 'ASSIGNMENT',
              position: existing.length + 1, data: { definitionId: created.assignmentKey, title },
            }] : existing;
            return {
              lessonKey: lesson.lessonKey, title: lesson.title, activityType: lesson.activityType,
              position: lesson.position, required: lesson.required, estimatedMinutes: lesson.estimatedMinutes,
              content: lesson.lessonId === lessonId ? { schemaVersion: 1, blocks } : lesson.content,
            };
          }),
        })),
      };
      const saveResponse = await fetch(`/api/learning/courses/${courseId}/versions/${version.version}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      const saved = await saveResponse.json().catch(() => ({})) as { error?: string };
      if (!saveResponse.ok) throw new Error(saved.error ?? 'LEARNING_ASSIGNMENT_BLOCK_SAVE_FAILED');

      setStatus('PUBLISHING');
      const publishResponse = await fetch(`/api/learning/assignments/${created.assignmentId}/versions/${created.version ?? 1}/publish`, { method: 'POST' });
      const published = await publishResponse.json().catch(() => ({})) as { error?: string };
      if (!publishResponse.ok) throw new Error(published.error ?? 'LEARNING_ASSIGNMENT_PUBLISH_FAILED');
      setStatus('PUBLISHED');
      router.refresh();
    } catch (cause) {
      setStatus('IDLE');
      setError(cause instanceof Error ? cause.message : 'LEARNING_ASSIGNMENT_CREATE_FAILED');
    }
  }

  if (version.state !== 'DRAFT') return <p>Create a draft course version before adding assignments.</p>;
  if (lessons.length === 0) return <p>Add a lesson before creating an assignment.</p>;

  return <form className="learningForm" onSubmit={(event) => void create(event)}>
    <h3 className="wide">New assignment</h3>
    <label>Lesson<select value={lessonId} onChange={(event) => setLessonId(event.target.value)}>{lessons.map((lesson) => <option key={lesson.lessonId} value={lesson.lessonId}>{lesson.title}</option>)}</select></label>
    <label>Assignment key<input required pattern="[a-z0-9]+([._-][a-z0-9]+)*" value={key} onChange={(event) => setKey(event.target.value.toLowerCase())} /></label>
    <label className="wide">Title<input required maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="wide">Instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
    <label>Maximum points<input required type="number" min="0.01" max="1000000" step="0.01" value={maxPoints} onChange={(event) => setMaxPoints(event.target.value)} /></label>
    <label>Attachments<select value={allowAttachments ? 'YES' : 'NO'} onChange={(event) => setAllowAttachments(event.target.value === 'YES')}><option value="NO">Text only</option><option value="YES">Allow files</option></select></label>
    {allowAttachments ? <label>Maximum files<input type="number" min="1" max="20" value={maxAttachments} onChange={(event) => setMaxAttachments(event.target.value)} /></label> : null}
    <label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
    <div className="wide assetActions"><button type="submit" disabled={status !== 'IDLE'}>{status === 'IDLE' ? 'Create and publish assignment' : 'Working…'}</button></div>
    <div className="wide" role="status" aria-live="polite">{status === 'PUBLISHED' ? 'Assignment published and attached to the lesson.' : status}</div>
    {error ? <p className="wide" role="alert">{error}</p> : null}
  </form>;
}
