'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TargetOption {
  readonly id: string;
  readonly label: string;
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

      <div className="wide"><button type="submit" disabled={busy || (section === 'assignments' && !targetId)}>{busy ? 'Creating…' : 'Create draft'}</button></div>
      {error ? <div className="aiError wide" role="alert">{error}</div> : null}
    </form>
  );
}
