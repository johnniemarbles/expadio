'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Option {
  readonly id: string;
  readonly label: string;
}

interface ProgramOption extends Option {
  readonly programId: string;
}

export function ProgramAuthoringPanel({
  courseVersions,
  assessmentVersions,
  publishedPrograms,
  learners,
}: {
  readonly courseVersions: readonly Option[];
  readonly assessmentVersions: readonly Option[];
  readonly publishedPrograms: readonly ProgramOption[];
  readonly learners: readonly Option[];
}) {
  const router = useRouter();

  const [programKey, setProgramKey] = useState('');
  const [programTitle, setProgramTitle] = useState('');
  const [programDescription, setProgramDescription] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<string[]>(courseVersions[0] ? [courseVersions[0].id] : []);
  const [selectedAssessments, setSelectedAssessments] = useState<string[]>([]);

  const [certificationKey, setCertificationKey] = useState('');
  const [certificationTitle, setCertificationTitle] = useState('');
  const [certificationDescription, setCertificationDescription] = useState('');
  const [certificationProgramVersionId, setCertificationProgramVersionId] = useState(publishedPrograms[0]?.id ?? '');
  const [validityDays, setValidityDays] = useState('');
  const [renewalWindowDays, setRenewalWindowDays] = useState('');

  const [learnerId, setLearnerId] = useState(learners[0]?.id ?? '');
  const [assignmentProgramId, setAssignmentProgramId] = useState(publishedPrograms[0]?.programId ?? '');

  const [busy, setBusy] = useState<'program' | 'certification' | 'assignment' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, current: string[], update: (next: string[]) => void) {
    update(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function createAndPublishProgram(event: React.FormEvent) {
    event.preventDefault();
    setBusy('program');
    setError(null);
    setNotice(null);
    try {
      const items = [
        ...selectedCourses.map((courseVersionId, index) => ({
          type: 'COURSE',
          courseVersionId,
          assessmentVersionId: null,
          position: index + 1,
          required: true,
        })),
        ...selectedAssessments.map((assessmentVersionId, index) => ({
          type: 'ASSESSMENT',
          courseVersionId: null,
          assessmentVersionId,
          position: selectedCourses.length + index + 1,
          required: true,
        })),
      ];
      if (items.length === 0) throw new Error('Select at least one published course or assessment requirement.');

      const createdResponse = await fetch('/api/learning/programs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          programKey,
          draft: {
            title: programTitle,
            description: programDescription,
            items,
          },
        }),
      });
      const created = await createdResponse.json() as {
        programId?: string;
        version?: number;
        error?: string;
      };
      if (!createdResponse.ok || !created.programId || !created.version) {
        throw new Error(created.error ?? 'Program creation failed.');
      }

      const publishResponse = await fetch(
        `/api/learning/programs/${created.programId}/versions/${created.version}/publish`,
        { method: 'POST' },
      );
      const published = await publishResponse.json() as { error?: string };
      if (!publishResponse.ok) throw new Error(published.error ?? 'Program publication failed.');

      setProgramKey('');
      setProgramTitle('');
      setProgramDescription('');
      setNotice('Program created and published. It can now be assigned and used by certifications.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Program authoring failed.');
    } finally {
      setBusy(null);
    }
  }

  async function createAndPublishCertification(event: React.FormEvent) {
    event.preventDefault();
    setBusy('certification');
    setError(null);
    setNotice(null);
    try {
      if (!certificationProgramVersionId) throw new Error('Select a published program version.');
      const validity = validityDays ? Number(validityDays) : null;
      const renewal = renewalWindowDays ? Number(renewalWindowDays) : null;

      const createdResponse = await fetch('/api/learning/certifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          certificationKey,
          draft: {
            title: certificationTitle,
            description: certificationDescription,
            programVersionId: certificationProgramVersionId,
            validityDays: validity,
            renewalWindowDays: renewal,
          },
        }),
      });
      const created = await createdResponse.json() as {
        certificationId?: string;
        version?: number;
        error?: string;
      };
      if (!createdResponse.ok || !created.certificationId || !created.version) {
        throw new Error(created.error ?? 'Certification creation failed.');
      }

      const publishResponse = await fetch(
        `/api/learning/certifications/${created.certificationId}/versions/${created.version}/publish`,
        { method: 'POST' },
      );
      const published = await publishResponse.json() as { error?: string };
      if (!publishResponse.ok) throw new Error(published.error ?? 'Certification publication failed.');

      setCertificationKey('');
      setCertificationTitle('');
      setCertificationDescription('');
      setNotice('Certification published. Eligible program completions can now issue this credential.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Certification authoring failed.');
    } finally {
      setBusy(null);
    }
  }

  async function assignProgram(event: React.FormEvent) {
    event.preventDefault();
    setBusy('assignment');
    setError(null);
    setNotice(null);
    try {
      if (!learnerId || !assignmentProgramId) throw new Error('Select a learner and published program.');
      const response = await fetch('/api/learning/program-enrollments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          learnerId,
          programId: assignmentProgramId,
          assignmentKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Program assignment failed.');
      setNotice('Program assigned to learner.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Program assignment failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adminSplit">
      <form className="learningForm" onSubmit={(event) => void createAndPublishProgram(event)}>
        <h3 className="wide">Program builder</h3>
        <label>Stable key<input value={programKey} onChange={(event) => setProgramKey(event.target.value.toLowerCase())} pattern="[a-z0-9]+([._-][a-z0-9]+)*" required /></label>
        <label>Title<input value={programTitle} onChange={(event) => setProgramTitle(event.target.value)} required /></label>
        <label className="wide">Description<textarea rows={3} value={programDescription} onChange={(event) => setProgramDescription(event.target.value)} /></label>

        <fieldset className="wide">
          <legend><strong>Course requirements</strong></legend>
          {courseVersions.length === 0 ? <p>No published courses available.</p> : courseVersions.map((item) => (
            <label key={item.id} style={{ display: 'block', marginTop: '.5rem' }}>
              <input type="checkbox" checked={selectedCourses.includes(item.id)} onChange={() => toggle(item.id, selectedCourses, setSelectedCourses)} />
              {' '}{item.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="wide">
          <legend><strong>Assessment requirements</strong></legend>
          {assessmentVersions.length === 0 ? <p>No published assessments available.</p> : assessmentVersions.map((item) => (
            <label key={item.id} style={{ display: 'block', marginTop: '.5rem' }}>
              <input type="checkbox" checked={selectedAssessments.includes(item.id)} onChange={() => toggle(item.id, selectedAssessments, setSelectedAssessments)} />
              {' '}{item.label}
            </label>
          ))}
        </fieldset>

        <p className="wide">Selected requirements are mandatory and pinned to immutable published versions.</p>
        <div className="wide"><button type="submit" disabled={busy !== null || selectedCourses.length + selectedAssessments.length === 0}>{busy === 'program' ? 'Publishing…' : 'Create & publish program'}</button></div>
      </form>

      <form className="learningForm" onSubmit={(event) => void createAndPublishCertification(event)}>
        <h3 className="wide">Certification</h3>
        <label>
          Program version
          <select value={certificationProgramVersionId} onChange={(event) => setCertificationProgramVersionId(event.target.value)} required>
            <option value="">Select program</option>
            {publishedPrograms.map((program) => <option key={program.id} value={program.id}>{program.label}</option>)}
          </select>
        </label>
        <label>Stable key<input value={certificationKey} onChange={(event) => setCertificationKey(event.target.value.toLowerCase())} pattern="[a-z0-9]+([._-][a-z0-9]+)*" required /></label>
        <label>Title<input value={certificationTitle} onChange={(event) => setCertificationTitle(event.target.value)} required /></label>
        <label className="wide">Description<textarea rows={3} value={certificationDescription} onChange={(event) => setCertificationDescription(event.target.value)} /></label>
        <label>Validity · days<input type="number" min="1" max="36500" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} placeholder="No expiry" /></label>
        <label>Renewal window · days<input type="number" min="1" max="36500" value={renewalWindowDays} onChange={(event) => setRenewalWindowDays(event.target.value)} placeholder="Optional" /></label>
        <div className="wide"><button type="submit" disabled={busy !== null || !certificationProgramVersionId}>{busy === 'certification' ? 'Publishing…' : 'Create & publish certification'}</button></div>
      </form>

      <form className="learningForm" onSubmit={(event) => void assignProgram(event)}>
        <h3 className="wide">Assign program</h3>
        <label>
          Learner
          <select value={learnerId} onChange={(event) => setLearnerId(event.target.value)} required>
            <option value="">Select learner</option>
            {learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.label}</option>)}
          </select>
        </label>
        <label>
          Published program
          <select value={assignmentProgramId} onChange={(event) => setAssignmentProgramId(event.target.value)} required>
            <option value="">Select program</option>
            {publishedPrograms.map((program) => <option key={program.programId} value={program.programId}>{program.label}</option>)}
          </select>
        </label>
        <div className="wide"><button type="submit" disabled={busy !== null || !learnerId || !assignmentProgramId}>{busy === 'assignment' ? 'Assigning…' : 'Assign program'}</button></div>
      </form>

      {notice ? <div className="wide" role="status">{notice}</div> : null}
      {error ? <div className="aiError wide" role="alert">{error}</div> : null}
    </div>
  );
}
