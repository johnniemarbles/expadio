'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TargetOption {
  readonly id: string;
  readonly label: string;
}

interface AssignmentRulePreview {
  readonly totalLearners: number;
  readonly matchedLearners: number;
  readonly unmatchedLearners: number;
  readonly sample: readonly {
    readonly learnerId: string;
    readonly fullName: string;
    readonly audienceType: string;
    readonly subjectLinked: boolean;
  }[];
}

type ManagedSection = 'skills' | 'assignments';

const endpointBySection: Record<ManagedSection, string> = {
  skills: '/api/learning/competency-frameworks',
  assignments: '/api/learning/assignment-rules',
};

export function LearningSectionAdminPanel({
  section,
  courseTargets = [],
  programTargets = [],
}: {
  readonly section: ManagedSection;
  readonly courseTargets?: readonly TargetOption[];
  readonly programTargets?: readonly TargetOption[];
}) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetType, setTargetType] = useState<'COURSE' | 'PROGRAM'>('COURSE');
  const [targetId, setTargetId] = useState(courseTargets[0]?.id ?? '');
  const [dueDays, setDueDays] = useState('');
  const [audienceType, setAudienceType] = useState('');
  const [subjectRequired, setSubjectRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AssignmentRulePreview | null>(null);

  const targets = useMemo(
    () => targetType === 'COURSE' ? courseTargets : programTargets,
    [courseTargets, programTargets, targetType],
  );

  function switchTargetType(next: 'COURSE' | 'PROGRAM') {
    setTargetType(next);
    const options = next === 'COURSE' ? courseTargets : programTargets;
    setTargetId(options[0]?.id ?? '');
    if (next === 'PROGRAM') setDueDays('');
  }

  function payload(): Record<string, unknown> {
    if (section === 'skills') {
      return { frameworkKey: key, draft: { title, description, competencies: [] } };
    }
    return {
      ruleKey: key,
      draft: {
        name: title,
        description,
        targetType,
        courseId: targetType === 'COURSE' ? targetId : null,
        programId: targetType === 'PROGRAM' ? targetId : null,
        dueDays: targetType === 'COURSE' && dueDays ? Number(dueDays) : null,
        conditions: {
          audienceTypes: audienceType ? [audienceType] : [],
          subjectRequired,
          metadataEquals: {},
        },
      },
    };
  }

  async function previewAudience() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch('/api/learning/assignment-rules/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft: payload().draft }),
      });
      const body = await response.json() as { preview?: AssignmentRulePreview; error?: string };
      if (!response.ok || !body.preview) throw new Error(body.error ?? 'Assignment preview failed.');
      setPreview(body.preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Assignment preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpointBySection[section], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Learning operation failed.');
      setKey('');
      setTitle('');
      setDescription('');
      setDueDays('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Learning operation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="learningForm" onSubmit={(event) => void submit(event)}>
      <h3 className="wide">{section === 'skills' ? 'Create competency framework' : 'Create assignment rule'}</h3>
      <label>
        Stable key
        <input
          value={key}
          onChange={(event) => setKey(event.target.value.toLowerCase())}
          placeholder="e.g. onboarding-basics"
          pattern="[a-z0-9]+([._-][a-z0-9]+)*"
          required
        />
      </label>
      <label>
        {section === 'assignments' ? 'Rule name' : 'Title'}
        <input value={title} onChange={(event) => setTitle(event.target.value)} required />
      </label>
      <label className="wide">
        Description
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>

      {section === 'skills' ? (
        <p className="wide">The framework starts as an editable draft. Competencies, levels and evidence rules can be added before publication.</p>
      ) : (
        <>
          <label>Target type<select value={targetType} onChange={(event) => switchTargetType(event.target.value as 'COURSE' | 'PROGRAM')}><option value="COURSE">Course</option><option value="PROGRAM">Program</option></select></label>
          <label>Target<select value={targetId} onChange={(event) => setTargetId(event.target.value)} required><option value="">Select target</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
          {targetType === 'COURSE' ? <label>Due in days<input type="number" min="1" max="3650" value={dueDays} onChange={(event) => setDueDays(event.target.value)} /></label> : null}
          <label>Audience<select value={audienceType} onChange={(event) => setAudienceType(event.target.value)}><option value="">Any audience</option><option>INTERNAL</option><option>PARTNER</option><option>CUSTOMER</option><option>EXTERNAL</option></select></label>
          <label className="wide"><input type="checkbox" checked={subjectRequired} onChange={(event) => setSubjectRequired(event.target.checked)} /> Require a linked sign-in identity</label>
        </>
      )}

      <div className="wide">
        {section === 'assignments' ? (
          <button type="button" disabled={busy || !targetId || !key || !title} onClick={() => void previewAudience()}>
            {busy ? 'Checking…' : 'Preview audience'}
          </button>
        ) : null}
        {' '}
        <button type="submit" disabled={busy || (section === 'assignments' && !targetId)}>{busy ? 'Creating…' : 'Create draft'}</button>
      </div>
      {preview ? (
        <section className="wide" aria-label="Assignment audience preview">
          <h4>{preview.matchedLearners} of {preview.totalLearners} active learners match</h4>
          <p>{preview.unmatchedLearners} learners do not match. Preview is read-only and creates no assignments.</p>
          {preview.sample.length > 0 ? (
            <ul>{preview.sample.map((learner) => (
              <li key={learner.learnerId}>
                {learner.fullName} · {learner.audienceType} · {learner.subjectLinked ? 'identity linked' : 'identity not linked'}
              </li>
            ))}</ul>
          ) : <p>No active learners match these conditions.</p>}
          {preview.matchedLearners > preview.sample.length ? <p>Showing the first {preview.sample.length} matches.</p> : null}
        </section>
      ) : null}
      {error ? <div className="aiError wide" role="alert">{error}</div> : null}
    </form>
  );
}
