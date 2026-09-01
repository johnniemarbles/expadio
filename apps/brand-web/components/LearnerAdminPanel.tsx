'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface LearnerOption { readonly learnerId: string; readonly fullName: string; }
interface CourseOption { readonly courseId: string; readonly title: string; }

export function LearnerAdminPanel({
  learners,
  courses,
}: {
  learners: readonly LearnerOption[];
  courses: readonly CourseOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [audienceType, setAudienceType] = useState('INTERNAL');
  const [learnerId, setLearnerId] = useState(learners[0]?.learnerId ?? '');
  const [courseId, setCourseId] = useState(courses[0]?.courseId ?? '');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState<'learner' | 'enrollment' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createLearner(event: React.FormEvent) {
    event.preventDefault();
    setBusy('learner'); setError(null);
    try {
      const response = await fetch('/api/learning/learners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: name, email, subjectId, audienceType }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Learner creation failed.');
      setName(''); setEmail(''); setSubjectId('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Learner creation failed.');
    } finally { setBusy(null); }
  }

  async function assignCourse(event: React.FormEvent) {
    event.preventDefault();
    setBusy('enrollment'); setError(null);
    try {
      const response = await fetch('/api/learning/enrollments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          learnerId,
          courseId,
          idempotencyKey: crypto.randomUUID(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Course assignment failed.');
      setDueAt('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Course assignment failed.');
    } finally { setBusy(null); }
  }

  return (
    <div className="adminSplit">
      <form className="learningForm" onSubmit={(event) => void createLearner(event)}>
        <h3 className="wide">Add learner</h3>
        <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Clerk subject ID<input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder="Optional: links sign-in identity" /></label>
        <label>Audience<select value={audienceType} onChange={(event) => setAudienceType(event.target.value)}><option>INTERNAL</option><option>PARTNER</option><option>CUSTOMER</option><option>EXTERNAL</option></select></label>
        <div className="wide"><button type="submit" disabled={busy !== null}>{busy === 'learner' ? 'Adding…' : 'Add learner'}</button></div>
      </form>

      <form className="learningForm" onSubmit={(event) => void assignCourse(event)}>
        <h3 className="wide">Assign published course</h3>
        <label>Learner<select value={learnerId} onChange={(event) => setLearnerId(event.target.value)} required><option value="">Select learner</option>{learners.map((learner) => <option key={learner.learnerId} value={learner.learnerId}>{learner.fullName}</option>)}</select></label>
        <label>Course<select value={courseId} onChange={(event) => setCourseId(event.target.value)} required><option value="">Select course</option>{courses.map((course) => <option key={course.courseId} value={course.courseId}>{course.title}</option>)}</select></label>
        <label className="wide">Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <div className="wide"><button type="submit" disabled={busy !== null || !learnerId || !courseId}>{busy === 'enrollment' ? 'Assigning…' : 'Assign course'}</button></div>
      </form>
      {error ? <div className="aiError" role="alert">{error}</div> : null}
    </div>
  );
}
