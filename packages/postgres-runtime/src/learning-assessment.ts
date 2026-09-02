import { randomUUID } from 'node:crypto';
import {
  LearningAssessmentValidationError,
  assertAssessmentPublishable,
  gradeQuestion,
  scorePercent,
  validateAssessmentDraft,
  validateQuestionDraft,
  type LearningAssessmentCompletionRequirement,
  type LearningAssessmentType,
  type LearningQuestionType,
} from '@expadio/learning';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { requireTenantModuleOperational } from './product-module.ts';
import { reconcileLearningEnrollmentCompletion } from './learning-enrollment.ts';
import { reconcileLearningProgramsForEvidence } from './learning-program-certification.ts';

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface QuestionVersionRow {
  readonly question_version_id: string;
  readonly question_id: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly question_type: LearningQuestionType;
  readonly prompt: string;
  readonly options: readonly { readonly key: string; readonly label: string }[];
  readonly answer_key: Record<string, unknown>;
  readonly explanation: string;
}

interface AssessmentVersionRow {
  readonly assessment_version_id: string;
  readonly assessment_id: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly title: string;
  readonly instructions: string;
  readonly assessment_type: LearningAssessmentType;
  readonly pass_percent: string | number;
  readonly max_attempts: number;
  readonly time_limit_seconds: number | null;
  readonly course_version_id: string | null;
  readonly completion_requirement: LearningAssessmentCompletionRequirement;
}

interface AttemptRow {
  readonly attempt_id: string;
  readonly assessment_id: string;
  readonly assessment_version_id: string;
  readonly learner_id: string;
  readonly enrollment_id: string | null;
  readonly course_version_id: string | null;
  readonly attempt_key: string;
  readonly attempt_number: number;
  readonly status: 'IN_PROGRESS' | 'GRADED' | 'VOID';
  readonly started_at: Date | string;
  readonly deadline_at: Date | string | null;
  readonly submitted_at: Date | string | null;
  readonly graded_at: Date | string | null;
  readonly score_points: string | number | null;
  readonly max_points: string | number | null;
  readonly score_percent: string | number | null;
  readonly passed: boolean | null;
}

export interface LearningQuestionBankSummary {
  readonly questionBankId: string;
  readonly bankKey: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

export interface LearningQuestionCreated {
  readonly questionId: string;
  readonly questionKey: string;
  readonly questionVersionId: string;
  readonly version: number;
  readonly state: 'DRAFT';
}

export interface LearningAssessmentSummary {
  readonly assessmentId: string;
  readonly assessmentKey: string;
  readonly currentPublishedVersion: number | null;
  readonly publishedTitle: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

export interface MyAssessmentSummary {
  readonly assessmentId: string;
  readonly assessmentKey: string;
  readonly assessmentVersionId: string;
  readonly assessmentVersion: number;
  readonly title: string;
  readonly type: LearningAssessmentType;
  readonly passPercent: number;
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly bestScorePercent: number | null;
  readonly passed: boolean;
  readonly enrollmentId: string;
  readonly courseVersionId: string;
  readonly completionRequirement: LearningAssessmentCompletionRequirement;
}

export interface MyAssessmentAttempt {
  readonly attemptId: string;
  readonly assessmentId: string;
  readonly assessmentVersionId: string;
  readonly assessmentVersion: number;
  readonly enrollmentId: string;
  readonly attemptNumber: number;
  readonly status: 'IN_PROGRESS' | 'GRADED' | 'VOID';
  readonly startedAt: string;
  readonly deadlineAt: string | null;
  readonly scorePercent: number | null;
  readonly passed: boolean | null;
  readonly questions: readonly {
    readonly questionVersionId: string;
    readonly position: number;
    readonly points: number;
    readonly prompt: string;
    readonly type: LearningQuestionType;
    readonly options: readonly { readonly key: string; readonly label: string }[];
  }[];
  readonly idempotent: boolean;
}

export interface AssessmentGradeResult {
  readonly attemptId: string;
  readonly status: 'GRADED';
  readonly scorePoints: number;
  readonly maxPoints: number;
  readonly scorePercent: number;
  readonly passed: boolean;
  readonly submittedAt: string;
  readonly idempotent: boolean;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function number(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function stableKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LearningAssessmentValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  const key = value.trim().toLowerCase();
  if (key.length > 160 || !KEY.test(key)) {
    throw new LearningAssessmentValidationError(field, 'INVALID_KEY', `${field} is invalid.`);
  }
  return key;
}

function stableUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw new LearningAssessmentValidationError(field, 'INVALID_IDENTIFIER', `${field} is invalid.`);
  }
  return value.trim();
}

async function requireLearning(client: PostgresClient, tenantId: string): Promise<void> {
  await requireTenantModuleOperational(client, { tenantId, moduleKey: 'learning' });
}

async function defaultAcademyId(client: PostgresClient, tenantId: string): Promise<string> {
  const result = await client.query<{ readonly academy_id: string }>(
    `SELECT academy_id
       FROM platform.learning_academies
      WHERE tenant_id = $1::uuid
        AND is_default = true
        AND status = 'ACTIVE'
      LIMIT 1`,
    [tenantId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_DEFAULT_ACADEMY_MISSING');
  return row.academy_id;
}

export async function createLearningQuestionBank(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly bankKey: unknown;
    readonly name: unknown;
  },
): Promise<LearningQuestionBankSummary> {
  await requireLearning(client, input.tenantId);
  const bankKey = stableKey(input.bankKey, 'bankKey');
  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.trim().length > 300) {
    throw new LearningAssessmentValidationError('name', 'INVALID_NAME', 'name is invalid.');
  }
  const academyId = await defaultAcademyId(client, input.tenantId);

  try {
    const result = await client.query<{
      readonly question_bank_id: string;
      readonly bank_key: string;
      readonly name: string;
      readonly status: 'ACTIVE' | 'ARCHIVED';
    }>(
      `INSERT INTO platform.learning_question_banks (
         tenant_id, academy_id, bank_key, name, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       RETURNING question_bank_id, bank_key, name, status`,
      [input.tenantId, academyId, bankKey, input.name.trim(), input.actorSubjectId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('LEARNING_QUESTION_BANK_INSERT_FAILED');
    return {
      questionBankId: row.question_bank_id,
      bankKey: row.bank_key,
      name: row.name,
      status: row.status,
    };
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_QUESTION_BANK_KEY_EXISTS');
    throw error;
  }
}

export async function listLearningQuestionBanks(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningQuestionBankSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly question_bank_id: string;
    readonly bank_key: string;
    readonly name: string;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  }>(
    `SELECT question_bank_id, bank_key, name, status
       FROM platform.learning_question_banks
      WHERE tenant_id = $1::uuid
      ORDER BY name, question_bank_id`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    questionBankId: row.question_bank_id,
    bankKey: row.bank_key,
    name: row.name,
    status: row.status,
  }));
}

export async function createLearningQuestion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly questionBankId: string;
    readonly questionKey: unknown;
    readonly draft: unknown;
  },
): Promise<LearningQuestionCreated> {
  await requireLearning(client, input.tenantId);
  const questionBankId = stableUuid(input.questionBankId, 'questionBankId');
  const questionKey = stableKey(input.questionKey, 'questionKey');
  const draft = validateQuestionDraft(input.draft);

  const bank = await client.query(
    `SELECT 1
       FROM platform.learning_question_banks
      WHERE tenant_id = $1::uuid
        AND question_bank_id = $2::uuid
        AND status = 'ACTIVE'`,
    [input.tenantId, questionBankId],
  );
  if (bank.rows[0] === undefined) throw new Error('LEARNING_QUESTION_BANK_NOT_FOUND');

  try {
    const question = await client.query<{ readonly question_id: string }>(
      `INSERT INTO platform.learning_questions (
         tenant_id, question_bank_id, question_key, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING question_id`,
      [input.tenantId, questionBankId, questionKey, input.actorSubjectId],
    );
    const questionId = question.rows[0]?.question_id;
    if (questionId === undefined) throw new Error('LEARNING_QUESTION_INSERT_FAILED');

    const version = await client.query<{ readonly question_version_id: string }>(
      `INSERT INTO platform.learning_question_versions (
         tenant_id, question_id, version, state, question_type, prompt, options,
         answer_key, explanation, created_by_subject_id, updated_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', $3, $4, $5::jsonb,
         $6::jsonb, $7, $8, $8
       )
       RETURNING question_version_id`,
      [
        input.tenantId,
        questionId,
        draft.type,
        draft.prompt,
        JSON.stringify(draft.options),
        JSON.stringify(draft.answerKey),
        draft.explanation,
        input.actorSubjectId,
      ],
    );
    const questionVersionId = version.rows[0]?.question_version_id;
    if (questionVersionId === undefined) throw new Error('LEARNING_QUESTION_VERSION_INSERT_FAILED');

    return {
      questionId,
      questionKey,
      questionVersionId,
      version: 1,
      state: 'DRAFT',
    };
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_QUESTION_KEY_EXISTS');
    throw error;
  }
}

export async function publishLearningQuestionVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly questionId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly questionVersionId: string; readonly version: number; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);

  const lockedQuestion = await client.query<{ readonly question_id: string }>(
    `SELECT question_id
       FROM platform.learning_questions
      WHERE tenant_id = $1::uuid
        AND question_id = $2::uuid
        AND status = 'ACTIVE'
      FOR UPDATE`,
    [input.tenantId, input.questionId],
  );
  if (lockedQuestion.rows[0] === undefined) throw new Error('LEARNING_QUESTION_NOT_FOUND');

  const versions = await client.query<QuestionVersionRow>(
    `SELECT question_version_id, question_id, version, state, question_type,
            prompt, options, answer_key, explanation
       FROM platform.learning_question_versions
      WHERE tenant_id = $1::uuid
        AND question_id = $2::uuid
        AND version = $3
      FOR UPDATE`,
    [input.tenantId, input.questionId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) throw new Error('LEARNING_QUESTION_VERSION_NOT_FOUND');
  if (target.state === 'PUBLISHED') {
    return { questionVersionId: target.question_version_id, version: target.version, idempotent: true };
  }
  if (target.state !== 'DRAFT') throw new Error('LEARNING_QUESTION_VERSION_NOT_PUBLISHABLE');

  await client.query(
    `UPDATE platform.learning_question_versions
        SET state = 'SUPERSEDED',
            updated_by_subject_id = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND question_id = $2::uuid
        AND state = 'PUBLISHED'
        AND version <> $4`,
    [input.tenantId, input.questionId, input.actorSubjectId, input.version],
  );

  await client.query(
    `UPDATE platform.learning_question_versions
        SET state = 'PUBLISHED',
            published_by_subject_id = $4,
            published_at = now(),
            updated_by_subject_id = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND question_id = $2::uuid
        AND version = $3`,
    [input.tenantId, input.questionId, input.version, input.actorSubjectId],
  );

  await client.query(
    `UPDATE platform.learning_questions
        SET current_published_version = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid AND question_id = $2::uuid`,
    [input.tenantId, input.questionId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.question',
      aggregateId: input.questionId,
      eventType: 'learning.question.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { questionVersionId: target.question_version_id, version: input.version },
      metadata: { source: 'learning.assessment.authoring' },
    },
  });

  return { questionVersionId: target.question_version_id, version: input.version, idempotent: false };
}

export async function createLearningAssessment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly assessmentKey: unknown;
    readonly draft: unknown;
  },
): Promise<{
  readonly assessmentId: string;
  readonly assessmentKey: string;
  readonly assessmentVersionId: string;
  readonly version: 1;
  readonly state: 'DRAFT';
}> {
  await requireLearning(client, input.tenantId);
  const assessmentKey = stableKey(input.assessmentKey, 'assessmentKey');
  const draft = validateAssessmentDraft(input.draft);
  assertAssessmentPublishable(draft);
  const academyId = await defaultAcademyId(client, input.tenantId);

  if (draft.courseVersionId !== null) {
    const course = await client.query<{ readonly state: string }>(
      `SELECT state
         FROM platform.learning_course_versions
        WHERE tenant_id = $1::uuid
          AND course_version_id = $2::uuid`,
      [input.tenantId, draft.courseVersionId],
    );
    const state = course.rows[0]?.state;
    if (state !== 'PUBLISHED' && state !== 'SUPERSEDED') {
      throw new Error('LEARNING_ASSESSMENT_COURSE_VERSION_NOT_AVAILABLE');
    }
  }

  const questionIds = draft.items.map((item) => item.questionVersionId);
  const questions = await client.query<{ readonly question_version_id: string; readonly state: string }>(
    `SELECT question_version_id, state
       FROM platform.learning_question_versions
      WHERE tenant_id = $1::uuid
        AND question_version_id = ANY($2::uuid[])`,
    [input.tenantId, questionIds],
  );
  if (questions.rows.length !== questionIds.length) throw new Error('LEARNING_ASSESSMENT_QUESTION_NOT_FOUND');
  if (questions.rows.some((row) => row.state !== 'PUBLISHED' && row.state !== 'SUPERSEDED')) {
    throw new Error('LEARNING_ASSESSMENT_QUESTION_NOT_PUBLISHED');
  }

  try {
    const assessment = await client.query<{ readonly assessment_id: string }>(
      `INSERT INTO platform.learning_assessments (
         tenant_id, academy_id, assessment_key, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING assessment_id`,
      [input.tenantId, academyId, assessmentKey, input.actorSubjectId],
    );
    const assessmentId = assessment.rows[0]?.assessment_id;
    if (assessmentId === undefined) throw new Error('LEARNING_ASSESSMENT_INSERT_FAILED');

    const version = await client.query<{ readonly assessment_version_id: string }>(
      `INSERT INTO platform.learning_assessment_versions (
         tenant_id, assessment_id, version, state, title, instructions,
         assessment_type, pass_percent, max_attempts, time_limit_seconds,
         course_version_id, completion_requirement, created_by_subject_id, updated_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', $3, $4,
         $5, $6, $7, $8, $9::uuid, $10, $11, $11
       )
       RETURNING assessment_version_id`,
      [
        input.tenantId,
        assessmentId,
        draft.title,
        draft.instructions,
        draft.type,
        draft.passPercent,
        draft.maxAttempts,
        draft.timeLimitSeconds,
        draft.courseVersionId,
        draft.completionRequirement,
        input.actorSubjectId,
      ],
    );
    const assessmentVersionId = version.rows[0]?.assessment_version_id;
    if (assessmentVersionId === undefined) throw new Error('LEARNING_ASSESSMENT_VERSION_INSERT_FAILED');

    for (const item of draft.items) {
      await client.query(
        `INSERT INTO platform.learning_assessment_items (
           tenant_id, assessment_version_id, question_version_id, position, points
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
        [input.tenantId, assessmentVersionId, item.questionVersionId, item.position, item.points],
      );
    }

    return {
      assessmentId,
      assessmentKey,
      assessmentVersionId,
      version: 1,
      state: 'DRAFT',
    };
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_ASSESSMENT_KEY_EXISTS');
    throw error;
  }
}

export async function listLearningAssessments(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningAssessmentSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly assessment_id: string;
    readonly assessment_key: string;
    readonly current_published_version: number | null;
    readonly published_title: string | null;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  }>(
    `SELECT a.assessment_id, a.assessment_key, a.current_published_version,
            v.title AS published_title, a.status
       FROM platform.learning_assessments a
       LEFT JOIN platform.learning_assessment_versions v
         ON v.assessment_id = a.assessment_id
        AND v.tenant_id = a.tenant_id
        AND v.state = 'PUBLISHED'
      WHERE a.tenant_id = $1::uuid
      ORDER BY a.updated_at DESC, a.assessment_key`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    assessmentId: row.assessment_id,
    assessmentKey: row.assessment_key,
    currentPublishedVersion: row.current_published_version,
    publishedTitle: row.published_title,
    status: row.status,
  }));
}

export async function publishLearningAssessmentVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly assessmentId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly assessmentVersionId: string; readonly version: number; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);

  const assessment = await client.query(
    `SELECT 1
       FROM platform.learning_assessments
      WHERE tenant_id = $1::uuid
        AND assessment_id = $2::uuid
        AND status = 'ACTIVE'
      FOR UPDATE`,
    [input.tenantId, input.assessmentId],
  );
  if (assessment.rows[0] === undefined) throw new Error('LEARNING_ASSESSMENT_NOT_FOUND');

  const versions = await client.query<AssessmentVersionRow>(
    `SELECT assessment_version_id, assessment_id, version, state, title,
            instructions, assessment_type, pass_percent, max_attempts,
            time_limit_seconds, course_version_id, completion_requirement
       FROM platform.learning_assessment_versions
      WHERE tenant_id = $1::uuid
        AND assessment_id = $2::uuid
        AND version = $3
      FOR UPDATE`,
    [input.tenantId, input.assessmentId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) throw new Error('LEARNING_ASSESSMENT_VERSION_NOT_FOUND');
  if (target.state === 'PUBLISHED') {
    return { assessmentVersionId: target.assessment_version_id, version: target.version, idempotent: true };
  }
  if (target.state !== 'DRAFT') throw new Error('LEARNING_ASSESSMENT_VERSION_NOT_PUBLISHABLE');

  const itemCount = await client.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count
       FROM platform.learning_assessment_items
      WHERE tenant_id = $1::uuid
        AND assessment_version_id = $2::uuid`,
    [input.tenantId, target.assessment_version_id],
  );
  if (Number(itemCount.rows[0]?.count ?? 0) === 0) {
    throw new Error('LEARNING_ASSESSMENT_ITEMS_REQUIRED');
  }

  await client.query(
    `UPDATE platform.learning_assessment_versions
        SET state = 'SUPERSEDED',
            updated_by_subject_id = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND assessment_id = $2::uuid
        AND state = 'PUBLISHED'
        AND version <> $4`,
    [input.tenantId, input.assessmentId, input.actorSubjectId, input.version],
  );

  await client.query(
    `UPDATE platform.learning_assessment_versions
        SET state = 'PUBLISHED',
            published_by_subject_id = $4,
            published_at = now(),
            updated_by_subject_id = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND assessment_id = $2::uuid
        AND version = $3`,
    [input.tenantId, input.assessmentId, input.version, input.actorSubjectId],
  );

  await client.query(
    `UPDATE platform.learning_assessments
        SET current_published_version = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid AND assessment_id = $2::uuid`,
    [input.tenantId, input.assessmentId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.assessment',
      aggregateId: input.assessmentId,
      eventType: 'learning.assessment.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        assessmentVersionId: target.assessment_version_id,
        version: input.version,
        courseVersionId: target.course_version_id,
      },
      metadata: { source: 'learning.assessment.authoring' },
    },
  });

  return { assessmentVersionId: target.assessment_version_id, version: input.version, idempotent: false };
}

async function activeLearner(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string; readonly subjectIssuer: string | null; readonly lock?: boolean },
): Promise<string> {
  const result = await client.query<{ readonly learner_id: string }>(
    `SELECT learner_id
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
        AND subject_id = $2
        AND subject_issuer IS NOT DISTINCT FROM $3
        AND status = 'ACTIVE'
      LIMIT 1
      ${input.lock === true ? 'FOR UPDATE' : ''}`,
    [input.tenantId, input.subjectId, input.subjectIssuer],
  );
  const learnerId = result.rows[0]?.learner_id;
  if (learnerId === undefined) throw new Error('LEARNING_LEARNER_NOT_FOUND');
  return learnerId;
}

export async function listMyAvailableAssessments(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string; readonly subjectIssuer: string | null },
): Promise<readonly MyAssessmentSummary[]> {
  await requireLearning(client, input.tenantId);
  const learnerId = await activeLearner(client, input);

  const result = await client.query<{
    readonly assessment_id: string;
    readonly assessment_key: string;
    readonly assessment_version_id: string;
    readonly version: number;
    readonly title: string;
    readonly assessment_type: LearningAssessmentType;
    readonly pass_percent: string | number;
    readonly max_attempts: number;
    readonly enrollment_id: string;
    readonly course_version_id: string;
    readonly attempts_used: string | number;
    readonly best_score_percent: string | number | null;
    readonly passed: boolean;
    readonly completion_requirement: LearningAssessmentCompletionRequirement;
  }>(
    `SELECT a.assessment_id, a.assessment_key, v.assessment_version_id,
            v.version, v.title, v.assessment_type, v.pass_percent, v.max_attempts,
            v.completion_requirement, e.enrollment_id, e.course_version_id,
            count(attempt.attempt_id) FILTER (WHERE attempt.status <> 'VOID') AS attempts_used,
            max(attempt.score_percent) FILTER (WHERE attempt.status = 'GRADED') AS best_score_percent,
            coalesce(bool_or(attempt.passed) FILTER (WHERE attempt.status = 'GRADED'), false) AS passed
       FROM platform.learning_assessments a
       JOIN platform.learning_assessment_versions v
         ON v.assessment_id = a.assessment_id
        AND v.tenant_id = a.tenant_id
        AND v.state = 'PUBLISHED'
       JOIN platform.learning_enrollments e
         ON e.tenant_id = a.tenant_id
        AND e.learner_id = $2::uuid
        AND e.course_version_id = v.course_version_id
        AND e.status NOT IN ('CANCELLED','EXPIRED')
       LEFT JOIN platform.learning_assessment_attempts attempt
         ON attempt.tenant_id = a.tenant_id
        AND attempt.learner_id = e.learner_id
        AND attempt.assessment_version_id = v.assessment_version_id
      WHERE a.tenant_id = $1::uuid
        AND a.status = 'ACTIVE'
        AND v.course_version_id IS NOT NULL
      GROUP BY a.assessment_id, a.assessment_key, v.assessment_version_id,
               v.version, v.title, v.assessment_type, v.pass_percent, v.max_attempts,
               v.completion_requirement, e.enrollment_id, e.course_version_id
      ORDER BY v.title, a.assessment_id`,
    [input.tenantId, learnerId],
  );

  return result.rows.map((row) => ({
    assessmentId: row.assessment_id,
    assessmentKey: row.assessment_key,
    assessmentVersionId: row.assessment_version_id,
    assessmentVersion: row.version,
    title: row.title,
    type: row.assessment_type,
    passPercent: number(row.pass_percent),
    maxAttempts: row.max_attempts,
    attemptsUsed: number(row.attempts_used),
    bestScorePercent: row.best_score_percent === null ? null : number(row.best_score_percent),
    passed: row.passed,
    enrollmentId: row.enrollment_id,
    courseVersionId: row.course_version_id,
    completionRequirement: row.completion_requirement,
  }));
}

export async function startMyAssessmentAttempt(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly assessmentId: string;
    readonly enrollmentId: string;
    readonly attemptKey: string;
    readonly correlationId: string;
  },
): Promise<MyAssessmentAttempt> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.assessmentId, 'assessmentId');
  stableUuid(input.enrollmentId, 'enrollmentId');
  if (input.attemptKey.trim() === '' || input.attemptKey.length > 300) {
    throw new LearningAssessmentValidationError('attemptKey', 'INVALID_ATTEMPT_KEY', 'attemptKey is invalid.');
  }

  const learnerId = await activeLearner(client, { ...input, lock: true });

  const existing = await client.query<AttemptRow>(
    `SELECT attempt_id, assessment_id, assessment_version_id, learner_id,
            enrollment_id, course_version_id, attempt_key, attempt_number, status,
            started_at, deadline_at, submitted_at, graded_at, score_points,
            max_points, score_percent, passed
       FROM platform.learning_assessment_attempts
      WHERE tenant_id = $1::uuid AND attempt_key = $2
      LIMIT 1`,
    [input.tenantId, input.attemptKey],
  );
  const replay = existing.rows[0];
  if (replay !== undefined) {
    if (
      replay.learner_id !== learnerId
      || replay.assessment_id !== input.assessmentId
      || replay.enrollment_id !== input.enrollmentId
    ) {
      throw new Error('LEARNING_ASSESSMENT_ATTEMPT_KEY_CONFLICT');
    }
    return loadAttemptProjection(client, input.tenantId, replay, true);
  }

  const assessmentResult = await client.query<AssessmentVersionRow>(
    `SELECT v.assessment_version_id, v.assessment_id, v.version, v.state, v.title,
            v.instructions, v.assessment_type, v.pass_percent, v.max_attempts,
            v.time_limit_seconds, v.course_version_id
       FROM platform.learning_assessments a
       JOIN platform.learning_assessment_versions v
         ON v.assessment_id = a.assessment_id
        AND v.tenant_id = a.tenant_id
        AND v.state = 'PUBLISHED'
      WHERE a.tenant_id = $1::uuid
        AND a.assessment_id = $2::uuid
        AND a.status = 'ACTIVE'
      FOR SHARE OF a, v`,
    [input.tenantId, input.assessmentId],
  );
  const assessment = assessmentResult.rows[0];
  if (assessment === undefined) throw new Error('LEARNING_ASSESSMENT_NOT_FOUND');
  if (assessment.course_version_id === null) throw new Error('LEARNING_ASSESSMENT_NOT_ASSIGNED');

  const enrollment = await client.query(
    `SELECT 1
       FROM platform.learning_enrollments
      WHERE tenant_id = $1::uuid
        AND enrollment_id = $2::uuid
        AND learner_id = $3::uuid
        AND course_version_id = $4::uuid
        AND status NOT IN ('CANCELLED','EXPIRED')
      LIMIT 1`,
    [input.tenantId, input.enrollmentId, learnerId, assessment.course_version_id],
  );
  if (enrollment.rows[0] === undefined) throw new Error('LEARNING_ASSESSMENT_ENROLLMENT_MISMATCH');

  const count = await client.query<{ readonly attempts_used: string; readonly next_number: string }>(
    `SELECT
       count(*) FILTER (WHERE status <> 'VOID')::text AS attempts_used,
       (coalesce(max(attempt_number), 0) + 1)::text AS next_number
       FROM platform.learning_assessment_attempts
      WHERE tenant_id = $1::uuid
        AND learner_id = $2::uuid
        AND assessment_version_id = $3::uuid`,
    [input.tenantId, learnerId, assessment.assessment_version_id],
  );
  const attemptsUsed = Number(count.rows[0]?.attempts_used ?? 0);
  if (attemptsUsed >= assessment.max_attempts) throw new Error('LEARNING_ASSESSMENT_ATTEMPT_LIMIT_REACHED');
  const attemptNumber = Number(count.rows[0]?.next_number ?? 1);

  const startedAt = new Date();
  const deadlineAt = assessment.time_limit_seconds === null
    ? null
    : new Date(startedAt.getTime() + assessment.time_limit_seconds * 1000);

  let attempt: AttemptRow;
  try {
    const inserted = await client.query<AttemptRow>(
      `INSERT INTO platform.learning_assessment_attempts (
         tenant_id, assessment_id, assessment_version_id, learner_id,
         enrollment_id, course_version_id, attempt_key, attempt_number,
         started_at, deadline_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         $5::uuid, $6::uuid, $7, $8, $9, $10
       )
       RETURNING attempt_id, assessment_id, assessment_version_id, learner_id,
                 enrollment_id, course_version_id, attempt_key, attempt_number, status,
                 started_at, deadline_at, submitted_at, graded_at, score_points,
                 max_points, score_percent, passed`,
      [
        input.tenantId,
        input.assessmentId,
        assessment.assessment_version_id,
        learnerId,
        input.enrollmentId,
        assessment.course_version_id,
        input.attemptKey,
        attemptNumber,
        startedAt,
        deadlineAt,
      ],
    );
    const insertedAttempt = inserted.rows[0];
    if (insertedAttempt === undefined) throw new Error('LEARNING_ASSESSMENT_ATTEMPT_INSERT_FAILED');
    attempt = insertedAttempt;
  } catch (error: any) {
    if (error?.code !== '23505') throw error;

    const raced = await client.query<AttemptRow>(
      `SELECT attempt_id, assessment_id, assessment_version_id, learner_id,
              enrollment_id, course_version_id, attempt_key, attempt_number, status,
              started_at, deadline_at, submitted_at, graded_at, score_points,
              max_points, score_percent, passed
         FROM platform.learning_assessment_attempts
        WHERE tenant_id = $1::uuid
          AND attempt_key = $2
        LIMIT 1`,
      [input.tenantId, input.attemptKey],
    );
    const racedAttempt = raced.rows[0];
    if (racedAttempt === undefined) throw error;
    if (
      racedAttempt.learner_id !== learnerId
      || racedAttempt.assessment_id !== input.assessmentId
      || racedAttempt.enrollment_id !== input.enrollmentId
    ) {
      throw new Error('LEARNING_ASSESSMENT_ATTEMPT_KEY_CONFLICT');
    }
    return loadAttemptProjection(client, input.tenantId, racedAttempt, true);
  }

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.assessment_attempt',
      aggregateId: attempt.attempt_id,
      eventType: 'learning.assessment.started',
      eventVersion: 1,
      occurredAt: startedAt,
      actorSubjectId: input.subjectId,
      correlationId: input.correlationId,
      payload: {
        assessmentId: input.assessmentId,
        assessmentVersionId: assessment.assessment_version_id,
        assessmentVersion: assessment.version,
        learnerId,
        enrollmentId: input.enrollmentId,
        attemptNumber,
      },
      metadata: { source: 'learning.assessment.attempt' },
    },
  });

  return loadAttemptProjection(client, input.tenantId, attempt, false);
}

async function loadAttemptProjection(
  client: PostgresClient,
  tenantId: string,
  attempt: AttemptRow,
  idempotent: boolean,
): Promise<MyAssessmentAttempt> {
  const version = await client.query<{ readonly version: number }>(
    `SELECT version
       FROM platform.learning_assessment_versions
      WHERE tenant_id = $1::uuid
        AND assessment_version_id = $2::uuid`,
    [tenantId, attempt.assessment_version_id],
  );
  const assessmentVersion = version.rows[0]?.version;
  if (assessmentVersion === undefined) throw new Error('LEARNING_ASSESSMENT_VERSION_NOT_FOUND');

  const questions = attempt.status === 'IN_PROGRESS'
    ? await client.query<{
      readonly question_version_id: string;
      readonly position: number;
      readonly points: string | number;
      readonly prompt: string;
      readonly question_type: LearningQuestionType;
      readonly options: readonly { readonly key: string; readonly label: string }[];
    }>(
      `SELECT item.question_version_id, item.position, item.points,
              q.prompt, q.question_type, q.options
         FROM platform.learning_assessment_items item
         JOIN platform.learning_question_versions q
           ON q.question_version_id = item.question_version_id
          AND q.tenant_id = item.tenant_id
        WHERE item.tenant_id = $1::uuid
          AND item.assessment_version_id = $2::uuid
        ORDER BY item.position`,
      [tenantId, attempt.assessment_version_id],
    )
    : { rows: [] as const };

  return {
    attemptId: attempt.attempt_id,
    assessmentId: attempt.assessment_id,
    assessmentVersionId: attempt.assessment_version_id,
    assessmentVersion,
    enrollmentId: attempt.enrollment_id ?? '',
    attemptNumber: attempt.attempt_number,
    status: attempt.status,
    startedAt: iso(attempt.started_at),
    deadlineAt: nullableIso(attempt.deadline_at),
    scorePercent: attempt.score_percent === null ? null : number(attempt.score_percent),
    passed: attempt.passed,
    questions: questions.rows.map((row) => ({
      questionVersionId: row.question_version_id,
      position: row.position,
      points: number(row.points),
      prompt: row.prompt,
      type: row.question_type,
      options: row.options.map((option) => ({ ...option })),
    })),
    idempotent,
  };
}

export async function submitMyAssessmentAttempt(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly attemptId: string;
    readonly responses: unknown;
    readonly correlationId: string;
  },
): Promise<AssessmentGradeResult> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.attemptId, 'attemptId');

  const attempts = await client.query<AttemptRow & {
    readonly assessment_version: number;
    readonly pass_percent: string | number;
  }>(
    `SELECT attempt.attempt_id, attempt.assessment_id,
            attempt.assessment_version_id, attempt.learner_id,
            attempt.enrollment_id, attempt.course_version_id, attempt.attempt_key,
            attempt.attempt_number, attempt.status, attempt.started_at,
            attempt.deadline_at, attempt.submitted_at, attempt.graded_at,
            attempt.score_points, attempt.max_points, attempt.score_percent,
            attempt.passed, v.version AS assessment_version, v.pass_percent
       FROM platform.learning_assessment_attempts attempt
       JOIN platform.learning_learners learner
         ON learner.learner_id = attempt.learner_id
        AND learner.tenant_id = attempt.tenant_id
        AND learner.subject_id = $3
        AND learner.subject_issuer IS NOT DISTINCT FROM $4
        AND learner.status = 'ACTIVE'
       JOIN platform.learning_assessment_versions v
         ON v.assessment_version_id = attempt.assessment_version_id
        AND v.tenant_id = attempt.tenant_id
      WHERE attempt.tenant_id = $1::uuid
        AND attempt.attempt_id = $2::uuid
      FOR UPDATE OF attempt`,
    [input.tenantId, input.attemptId, input.subjectId, input.subjectIssuer],
  );
  const attempt = attempts.rows[0];
  if (attempt === undefined) throw new Error('LEARNING_ASSESSMENT_ATTEMPT_NOT_FOUND');

  if (attempt.status === 'GRADED') {
    return {
      attemptId: attempt.attempt_id,
      status: 'GRADED',
      scorePoints: number(attempt.score_points),
      maxPoints: number(attempt.max_points),
      scorePercent: number(attempt.score_percent),
      passed: attempt.passed === true,
      submittedAt: iso(attempt.submitted_at!),
      idempotent: true,
    };
  }
  if (attempt.status !== 'IN_PROGRESS') throw new Error('LEARNING_ASSESSMENT_ATTEMPT_NOT_SUBMITTABLE');

  const now = new Date();
  if (attempt.deadline_at !== null && now.getTime() > new Date(attempt.deadline_at).getTime()) {
    throw new Error('LEARNING_ASSESSMENT_ATTEMPT_EXPIRED');
  }

  if (input.responses === null || typeof input.responses !== 'object' || Array.isArray(input.responses)) {
    throw new LearningAssessmentValidationError('responses', 'INVALID_RESPONSES', 'responses must be an object.');
  }
  const responseList = (input.responses as Record<string, unknown>).responses;
  if (!Array.isArray(responseList)) {
    throw new LearningAssessmentValidationError('responses', 'INVALID_RESPONSES', 'responses must be an array.');
  }

  const responseMap = new Map<string, unknown>();
  for (const [index, raw] of responseList.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LearningAssessmentValidationError(`responses[${index}]`, 'INVALID_RESPONSE', 'response is invalid.');
    }
    const item = raw as Record<string, unknown>;
    const questionVersionId = stableUuid(item.questionVersionId, `responses[${index}].questionVersionId`);
    if (responseMap.has(questionVersionId)) {
      throw new LearningAssessmentValidationError('responses', 'DUPLICATE_RESPONSE', 'Question responses must be unique.');
    }
    responseMap.set(questionVersionId, item.response ?? null);
  }

  const items = await client.query<{
    readonly question_version_id: string;
    readonly points: string | number;
    readonly question_type: LearningQuestionType;
    readonly prompt: string;
    readonly options: readonly { readonly key: string; readonly label: string }[];
    readonly answer_key: Record<string, unknown>;
    readonly explanation: string;
  }>(
    `SELECT item.question_version_id, item.points, q.question_type,
            q.prompt, q.options, q.answer_key, q.explanation
       FROM platform.learning_assessment_items item
       JOIN platform.learning_question_versions q
         ON q.question_version_id = item.question_version_id
        AND q.tenant_id = item.tenant_id
      WHERE item.tenant_id = $1::uuid
        AND item.assessment_version_id = $2::uuid
      ORDER BY item.position`,
    [input.tenantId, attempt.assessment_version_id],
  );
  if (items.rows.length === 0) throw new Error('LEARNING_ASSESSMENT_ITEMS_MISSING');

  const expectedIds = new Set(items.rows.map((item) => item.question_version_id));
  for (const questionVersionId of responseMap.keys()) {
    if (!expectedIds.has(questionVersionId)) {
      throw new LearningAssessmentValidationError(
        'responses',
        'UNKNOWN_QUESTION_RESPONSE',
        'A response references a question outside this assessment version.',
      );
    }
  }

  let awarded = 0;
  let maximum = 0;
  const graded = items.rows.map((item) => {
    const points = number(item.points);
    const result = gradeQuestion({
      type: item.question_type,
      answerKey: item.answer_key,
      response: responseMap.get(item.question_version_id) ?? null,
      points,
    });
    awarded += result.awardedPoints;
    maximum += points;
    return {
      questionVersionId: item.question_version_id,
      response: responseMap.get(item.question_version_id) ?? null,
      correct: result.correct,
      awardedPoints: result.awardedPoints,
      maxPoints: points,
    };
  });

  const percent = scorePercent(awarded, maximum);
  const passed = percent >= number(attempt.pass_percent);

  for (const item of graded) {
    await client.query(
      `INSERT INTO platform.learning_assessment_responses (
         tenant_id, attempt_id, assessment_version_id, question_version_id,
         response, correct, awarded_points, max_points, graded_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         $5::jsonb, $6, $7, $8, $9
       )`,
      [
        input.tenantId,
        attempt.attempt_id,
        attempt.assessment_version_id,
        item.questionVersionId,
        JSON.stringify(item.response),
        item.correct,
        item.awardedPoints,
        item.maxPoints,
        now,
      ],
    );
  }

  await client.query(
    `UPDATE platform.learning_assessment_attempts
        SET status = 'GRADED',
            submitted_at = $3,
            graded_at = $3,
            score_points = $4,
            max_points = $5,
            score_percent = $6,
            passed = $7,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND attempt_id = $2::uuid`,
    [input.tenantId, attempt.attempt_id, now, awarded, maximum, percent, passed],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.assessment_attempt',
      aggregateId: attempt.attempt_id,
      eventType: passed ? 'learning.assessment.passed' : 'learning.assessment.failed',
      eventVersion: 1,
      occurredAt: now,
      actorSubjectId: input.subjectId,
      correlationId: input.correlationId,
      payload: {
        assessmentId: attempt.assessment_id,
        assessmentVersionId: attempt.assessment_version_id,
        assessmentVersion: attempt.assessment_version,
        learnerId: attempt.learner_id,
        enrollmentId: attempt.enrollment_id,
        attemptNumber: attempt.attempt_number,
        scorePercent: percent,
        passed,
      },
      metadata: { source: 'learning.assessment.grading' },
    },
  });

  if (attempt.enrollment_id !== null) {
    await reconcileLearningEnrollmentCompletion(client, {
      tenantId: input.tenantId,
      enrollmentId: attempt.enrollment_id,
      actorSubjectId: input.subjectId,
      correlationId: input.correlationId,
    });
  }

  if (passed) {
    await reconcileLearningProgramsForEvidence(client, {
      tenantId: input.tenantId,
      learnerId: attempt.learner_id,
      actorSubjectId: input.subjectId,
      correlationId: input.correlationId,
      assessmentVersionId: attempt.assessment_version_id,
    });
  }

  return {
    attemptId: attempt.attempt_id,
    status: 'GRADED',
    scorePoints: awarded,
    maxPoints: maximum,
    scorePercent: percent,
    passed,
    submittedAt: now.toISOString(),
    idempotent: false,
  };
}
