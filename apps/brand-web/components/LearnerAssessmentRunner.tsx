'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AssessmentSummary {
  readonly assessmentId: string;
  readonly title: string;
  readonly type: string;
  readonly passPercent: number;
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly bestScorePercent: number | null;
  readonly passed: boolean;
  readonly enrollmentId: string;
}

interface AttemptQuestion {
  readonly questionVersionId: string;
  readonly position: number;
  readonly points: number;
  readonly prompt: string;
  readonly type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  readonly options: readonly { readonly key: string; readonly label: string }[];
}

interface Attempt {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly deadlineAt: string | null;
  readonly questions: readonly AttemptQuestion[];
}

interface Grade {
  readonly scorePercent: number;
  readonly passed: boolean;
}

export function LearnerAssessmentRunner({ assessments }: { readonly assessments: readonly AssessmentSummary[] }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [activeTitle, setActiveTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [grade, setGrade] = useState<Grade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(assessment: AssessmentSummary) {
    setBusy(true);
    setError(null);
    setGrade(null);
    try {
      const response = await fetch(`/api/learning/me/assessments/${assessment.assessmentId}/attempts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enrollmentId: assessment.enrollmentId,
          attemptKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json() as Attempt & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not start assessment.');
      setAttempt(body);
      setActiveTitle(assessment.title);
      setAnswers({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start assessment.');
    } finally {
      setBusy(false);
    }
  }

  function setSingle(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function toggleMultiple(questionId: string, value: string) {
    setAnswers((current) => {
      const existing = Array.isArray(current[questionId]) ? current[questionId] as string[] : [];
      return {
        ...current,
        [questionId]: existing.includes(value)
          ? existing.filter((item) => item !== value)
          : [...existing, value],
      };
    });
  }

  async function submit() {
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/learning/me/assessment-attempts/${attempt.attemptId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          responses: attempt.questions.map((question) => ({
            questionVersionId: question.questionVersionId,
            response: answers[question.questionVersionId] ?? null,
          })),
        }),
      });
      const body = await response.json() as Grade & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not submit assessment.');
      setGrade(body);
      setAttempt(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit assessment.');
    } finally {
      setBusy(false);
    }
  }

  if (assessments.length === 0) return <div>No published assessments are assigned to this course yet.</div>;

  return (
    <div>
      {grade ? (
        <div role="status">
          <strong>{grade.passed ? 'Assessment passed' : 'Assessment not passed'}</strong>
          <p>Score: {grade.scorePercent}%</p>
        </div>
      ) : null}
      {error ? <div className="aiError" role="alert">{error}</div> : null}

      {attempt ? (
        <div>
          <h3>{activeTitle} · Attempt {attempt.attemptNumber}</h3>
          {attempt.deadlineAt ? <p>Submit before {new Date(attempt.deadlineAt).toLocaleString()}.</p> : null}
          {attempt.questions.map((question) => (
            <fieldset key={question.questionVersionId} style={{ marginBottom: '1.5rem' }}>
              <legend><strong>{question.position}. {question.prompt}</strong> · {question.points} pts</legend>
              {question.options.map((option) => {
                const multiple = question.type === 'MULTIPLE_CHOICE';
                const selected = multiple
                  ? Array.isArray(answers[question.questionVersionId])
                    && (answers[question.questionVersionId] as string[]).includes(option.key)
                  : answers[question.questionVersionId] === option.key;
                return (
                  <label key={option.key} style={{ display: 'block', marginTop: '.5rem' }}>
                    <input
                      type={multiple ? 'checkbox' : 'radio'}
                      name={question.questionVersionId}
                      checked={selected}
                      onChange={() => multiple
                        ? toggleMultiple(question.questionVersionId, option.key)
                        : setSingle(question.questionVersionId, option.key)}
                    />
                    {' '}{option.label}
                  </label>
                );
              })}
            </fieldset>
          ))}
          <button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Submitting…' : 'Submit assessment'}
          </button>
        </div>
      ) : (
        <div>
          {assessments.map((assessment) => {
            const remaining = Math.max(0, assessment.maxAttempts - assessment.attemptsUsed);
            return (
              <div key={assessment.assessmentId} style={{ marginBottom: '1rem' }}>
                <strong>{assessment.title}</strong>
                <div>{assessment.type} · pass {assessment.passPercent}% · attempts {assessment.attemptsUsed}/{assessment.maxAttempts}</div>
                <div>{assessment.passed ? 'Passed' : assessment.bestScorePercent === null ? 'Not attempted' : `Best score ${assessment.bestScorePercent}%`}</div>
                {!assessment.passed && remaining > 0 ? (
                  <button type="button" disabled={busy} onClick={() => void start(assessment)}>
                    {busy ? 'Starting…' : assessment.attemptsUsed > 0 ? 'Try again' : 'Start assessment'}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
