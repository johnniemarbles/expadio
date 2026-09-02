'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Option {
  readonly id: string;
  readonly label: string;
}

interface QuestionOption extends Option {
  readonly type: string;
}

function parseOptions(source: string): readonly { key: string; label: string }[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('|');
      if (separator < 1) throw new Error('Each option must use key|label format.');
      return {
        key: line.slice(0, separator).trim().toLowerCase(),
        label: line.slice(separator + 1).trim(),
      };
    });
}

export function AssessmentAuthoringPanel({
  courseVersions,
  questionBanks,
  publishedQuestions,
}: {
  readonly courseVersions: readonly Option[];
  readonly questionBanks: readonly Option[];
  readonly publishedQuestions: readonly QuestionOption[];
}) {
  const router = useRouter();

  const [bankId, setBankId] = useState(questionBanks[0]?.id ?? '');
  const [questionKey, setQuestionKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [questionType, setQuestionType] = useState<'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE'>('SINGLE_CHOICE');
  const [optionText, setOptionText] = useState('a|Option A\nb|Option B');
  const [answerKeys, setAnswerKeys] = useState('a');
  const [explanation, setExplanation] = useState('');

  const [assessmentKey, setAssessmentKey] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [assessmentType, setAssessmentType] = useState<'QUIZ' | 'EXAM' | 'PRACTICE'>('QUIZ');
  const [passPercent, setPassPercent] = useState('80');
  const [maxAttempts, setMaxAttempts] = useState('3');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState('');
  const [courseVersionId, setCourseVersionId] = useState(courseVersions[0]?.id ?? '');
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>(publishedQuestions[0] ? [publishedQuestions[0].id] : []);

  const [busy, setBusy] = useState<'question' | 'assessment' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const questionMap = useMemo(
    () => new Map(publishedQuestions.map((question) => [question.id, question])),
    [publishedQuestions],
  );

  function toggleQuestion(id: string) {
    setSelectedQuestions((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function createAndPublishQuestion(event: React.FormEvent) {
    event.preventDefault();
    setBusy('question');
    setError(null);
    setNotice(null);
    try {
      if (!bankId) throw new Error('Create or select a question bank first.');

      const options = questionType === 'TRUE_FALSE'
        ? [{ key: 'true', label: 'True' }, { key: 'false', label: 'False' }]
        : parseOptions(optionText);
      const answers = answerKeys
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const answerKey = questionType === 'MULTIPLE_CHOICE'
        ? { answers }
        : { answer: answers[0] ?? '' };

      const createdResponse = await fetch(`/api/learning/question-banks/${bankId}/questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionKey,
          draft: {
            prompt,
            type: questionType,
            options,
            answerKey,
            explanation,
          },
        }),
      });
      const created = await createdResponse.json() as {
        questionId?: string;
        version?: number;
        error?: string;
      };
      if (!createdResponse.ok || !created.questionId || !created.version) {
        throw new Error(created.error ?? 'Question creation failed.');
      }

      const publishResponse = await fetch(
        `/api/learning/questions/${created.questionId}/versions/${created.version}/publish`,
        { method: 'POST' },
      );
      const published = await publishResponse.json() as { error?: string };
      if (!publishResponse.ok) throw new Error(published.error ?? 'Question publication failed.');

      setQuestionKey('');
      setPrompt('');
      setExplanation('');
      setNotice('Question created and published. It is now available for assessment composition.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Question authoring failed.');
    } finally {
      setBusy(null);
    }
  }

  async function createAndPublishAssessment(event: React.FormEvent) {
    event.preventDefault();
    setBusy('assessment');
    setError(null);
    setNotice(null);
    try {
      if (!courseVersionId) throw new Error('Select a published course version.');
      if (selectedQuestions.length === 0) throw new Error('Select at least one published question.');

      const createdResponse = await fetch('/api/learning/assessments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assessmentKey,
          draft: {
            title,
            instructions,
            type: assessmentType,
            passPercent: Number(passPercent),
            maxAttempts: Number(maxAttempts),
            timeLimitSeconds: timeLimitMinutes ? Number(timeLimitMinutes) * 60 : null,
            courseVersionId,
            items: selectedQuestions.map((questionVersionId, index) => ({
              questionVersionId,
              position: index + 1,
              points: 1,
            })),
          },
        }),
      });
      const created = await createdResponse.json() as {
        assessmentId?: string;
        version?: number;
        error?: string;
      };
      if (!createdResponse.ok || !created.assessmentId || !created.version) {
        throw new Error(created.error ?? 'Assessment creation failed.');
      }

      const publishResponse = await fetch(
        `/api/learning/assessments/${created.assessmentId}/versions/${created.version}/publish`,
        { method: 'POST' },
      );
      const published = await publishResponse.json() as { error?: string };
      if (!publishResponse.ok) throw new Error(published.error ?? 'Assessment publication failed.');

      setAssessmentKey('');
      setTitle('');
      setInstructions('');
      setNotice('Assessment created and published to the selected course version.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Assessment authoring failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adminSplit">
      <form className="learningForm" onSubmit={(event) => void createAndPublishQuestion(event)}>
        <h3 className="wide">Question authoring</h3>
        <label>
          Question bank
          <select value={bankId} onChange={(event) => setBankId(event.target.value)} required>
            <option value="">Select bank</option>
            {questionBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.label}</option>)}
          </select>
        </label>
        <label>
          Stable key
          <input value={questionKey} onChange={(event) => setQuestionKey(event.target.value.toLowerCase())} pattern="[a-z0-9]+([._-][a-z0-9]+)*" required />
        </label>
        <label className="wide">Prompt<textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></label>
        <label>
          Question type
          <select value={questionType} onChange={(event) => setQuestionType(event.target.value as typeof questionType)}>
            <option>SINGLE_CHOICE</option>
            <option>MULTIPLE_CHOICE</option>
            <option>TRUE_FALSE</option>
          </select>
        </label>
        <label>
          Correct answer key{questionType === 'MULTIPLE_CHOICE' ? 's' : ''}
          <input value={answerKeys} onChange={(event) => setAnswerKeys(event.target.value)} placeholder={questionType === 'MULTIPLE_CHOICE' ? 'a,c' : 'a'} required />
        </label>
        {questionType !== 'TRUE_FALSE' ? (
          <label className="wide">Options · one key|label per line<textarea rows={4} value={optionText} onChange={(event) => setOptionText(event.target.value)} required /></label>
        ) : null}
        <label className="wide">Explanation<textarea rows={2} value={explanation} onChange={(event) => setExplanation(event.target.value)} /></label>
        <div className="wide"><button type="submit" disabled={busy !== null || !bankId}>{busy === 'question' ? 'Publishing…' : 'Create & publish question'}</button></div>
      </form>

      <form className="learningForm" onSubmit={(event) => void createAndPublishAssessment(event)}>
        <h3 className="wide">Assessment composition</h3>
        <label>Stable key<input value={assessmentKey} onChange={(event) => setAssessmentKey(event.target.value.toLowerCase())} pattern="[a-z0-9]+([._-][a-z0-9]+)*" required /></label>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        <label className="wide">Instructions<textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <label>
          Course version
          <select value={courseVersionId} onChange={(event) => setCourseVersionId(event.target.value)} required>
            <option value="">Select published course</option>
            {courseVersions.map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}
          </select>
        </label>
        <label>
          Type
          <select value={assessmentType} onChange={(event) => setAssessmentType(event.target.value as typeof assessmentType)}>
            <option>QUIZ</option><option>EXAM</option><option>PRACTICE</option>
          </select>
        </label>
        <label>Pass percent<input type="number" min="0" max="100" step="0.01" value={passPercent} onChange={(event) => setPassPercent(event.target.value)} required /></label>
        <label>Max attempts<input type="number" min="1" max="100" value={maxAttempts} onChange={(event) => setMaxAttempts(event.target.value)} required /></label>
        <label className="wide">Time limit · minutes<input type="number" min="1" max="10080" value={timeLimitMinutes} onChange={(event) => setTimeLimitMinutes(event.target.value)} placeholder="Optional" /></label>

        <fieldset className="wide">
          <legend><strong>Published questions</strong></legend>
          {publishedQuestions.length === 0 ? <p>No published questions yet. Create one first.</p> : publishedQuestions.map((question) => (
            <label key={question.id} style={{ display: 'block', marginTop: '.5rem' }}>
              <input type="checkbox" checked={selectedQuestions.includes(question.id)} onChange={() => toggleQuestion(question.id)} />
              {' '}{question.label} · {questionMap.get(question.id)?.type}
            </label>
          ))}
        </fieldset>

        <div className="wide"><button type="submit" disabled={busy !== null || !courseVersionId || selectedQuestions.length === 0}>{busy === 'assessment' ? 'Publishing…' : 'Create & publish assessment'}</button></div>
      </form>

      {notice ? <div className="wide" role="status">{notice}</div> : null}
      {error ? <div className="aiError wide" role="alert">{error}</div> : null}
    </div>
  );
}
