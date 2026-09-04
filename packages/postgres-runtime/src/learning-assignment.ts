import { randomUUID } from 'node:crypto';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { requireTenantModuleOperational } from './product-module.ts';
import { reconcileLearningEnrollmentCompletion } from './learning-enrollment.ts';

async function requireLearning(client: PostgresClient, tenantId: string): Promise<void> {
  await requireTenantModuleOperational(client, { tenantId, moduleKey: 'LEARNING' });
}

export interface LearningAssignmentSubmission {
  readonly submissionId: string;
  readonly assignmentVersionId: string;
  readonly assignmentKey: string;
  readonly title: string;
  readonly learnerId: string;
  readonly enrollmentId: string;
  readonly lessonId: string;
  readonly attemptNumber: number;
  readonly status: 'SUBMITTED' | 'RETURNED' | 'GRADED' | 'VOID';
  readonly responseText: string;
  readonly scorePoints: number | null;
  readonly maxPoints: number;
  readonly feedback: string;
  readonly submittedAt: string;
  readonly gradedAt: string | null;
}

interface SubmissionRow {
  readonly submission_id: string;
  readonly assignment_version_id: string;
  readonly assignment_key: string;
  readonly title: string;
  readonly learner_id: string;
  readonly enrollment_id: string;
  readonly lesson_id: string;
  readonly attempt_number: number;
  readonly status: LearningAssignmentSubmission['status'];
  readonly response_text: string;
  readonly score_points: string | number | null;
  readonly max_points: string | number;
  readonly feedback: string;
  readonly submitted_at: Date | string;
  readonly graded_at: Date | string | null;
}

function project(row: SubmissionRow): LearningAssignmentSubmission {
  return {
    submissionId: row.submission_id,
    assignmentVersionId: row.assignment_version_id,
    assignmentKey: row.assignment_key,
    title: row.title,
    learnerId: row.learner_id,
    enrollmentId: row.enrollment_id,
    lessonId: row.lesson_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    responseText: row.response_text,
    scorePoints: row.score_points === null ? null : Number(row.score_points),
    maxPoints: Number(row.max_points),
    feedback: row.feedback,
    submittedAt: new Date(row.submitted_at).toISOString(),
    gradedAt: row.graded_at === null ? null : new Date(row.graded_at).toISOString(),
  };
}

const SUBMISSION_SELECT = `submission.submission_id, submission.assignment_version_id,
  assignment.assignment_key, version.title, submission.learner_id,
  submission.enrollment_id, submission.lesson_id, submission.attempt_number,
  submission.status, submission.response_text, submission.score_points,
  version.max_points, submission.feedback, submission.submitted_at, submission.graded_at`;

export async function submitMyLearningAssignment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly enrollmentId: string;
    readonly lessonId: string;
    readonly assignmentKey: string;
    readonly submissionKey: string;
    readonly responseText: string;
    readonly attachmentAssetIds?: readonly string[];
    readonly correlationId: string;
  },
): Promise<LearningAssignmentSubmission> {
  await requireLearning(client, input.tenantId);
  const responseText = input.responseText.trim();
  const attachmentAssetIds = [...new Set(input.attachmentAssetIds ?? [])];
  if (attachmentAssetIds.length > 20) throw new Error('LEARNING_ASSIGNMENT_ATTACHMENTS_TOO_MANY');
  if (responseText.length > 100_000) throw new Error('LEARNING_ASSIGNMENT_RESPONSE_TOO_LONG');

  const target = await client.query<{
    readonly learner_id: string;
    readonly course_version_id: string;
    readonly assignment_id: string;
    readonly assignment_version_id: string;
    readonly title: string;
    readonly max_points: string | number;
    readonly allow_text: boolean;
    readonly allow_attachments: boolean;
    readonly max_attachments: number;
    readonly due_at: Date | string | null;
  }>(
    `SELECT learner.learner_id, enrollment.course_version_id, assignment.assignment_id,
            version.assignment_version_id, version.title, version.max_points, version.allow_text, version.allow_attachments, version.max_attachments, version.due_at
       FROM platform.learning_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id = enrollment.learner_id AND learner.tenant_id = enrollment.tenant_id
        AND learner.subject_id = $3 AND learner.subject_issuer IS NOT DISTINCT FROM $4
        AND learner.status = 'ACTIVE'
       JOIN platform.learning_lessons lesson
         ON lesson.lesson_id = $5::uuid AND lesson.tenant_id = enrollment.tenant_id
        AND lesson.course_version_id = enrollment.course_version_id
       JOIN platform.learning_assignments assignment
         ON assignment.tenant_id = enrollment.tenant_id AND assignment.assignment_key = $6
        AND assignment.status = 'ACTIVE'
       JOIN platform.learning_assignment_versions version
         ON version.assignment_id = assignment.assignment_id AND version.tenant_id = assignment.tenant_id
        AND version.course_version_id = enrollment.course_version_id AND version.state = 'PUBLISHED'
      WHERE enrollment.tenant_id = $1::uuid AND enrollment.enrollment_id = $2::uuid
        AND enrollment.status IN ('ASSIGNED','IN_PROGRESS')
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(lesson.content->'blocks') = 'array'
              THEN lesson.content->'blocks' ELSE '[]'::jsonb END
          ) block
          WHERE block->>'type' = 'ASSIGNMENT' AND block->'data'->>'definitionId' = assignment.assignment_key
        )
        AND NOT EXISTS (
          SELECT 1
            FROM platform.learning_lessons prior
            JOIN platform.learning_course_modules prior_module
              ON prior_module.course_module_id = prior.course_module_id AND prior_module.tenant_id = prior.tenant_id
            JOIN platform.learning_course_modules target_module
              ON target_module.course_module_id = lesson.course_module_id AND target_module.tenant_id = lesson.tenant_id
           WHERE prior.tenant_id = enrollment.tenant_id
             AND prior.course_version_id = enrollment.course_version_id AND prior.required = true
             AND (prior_module.position, prior.position) < (target_module.position, lesson.position)
             AND NOT EXISTS (
               SELECT 1 FROM platform.learning_lesson_progress progress
                WHERE progress.tenant_id = enrollment.tenant_id
                  AND progress.enrollment_id = enrollment.enrollment_id
                  AND progress.lesson_id = prior.lesson_id AND progress.status = 'COMPLETED'
             )
        )
      FOR UPDATE OF enrollment`,
    [input.tenantId, input.enrollmentId, input.subjectId, input.subjectIssuer, input.lessonId, input.assignmentKey],
  );
  const row = target.rows[0];
  if (!row) throw new Error('LEARNING_ASSIGNMENT_NOT_AVAILABLE');
  if (row.due_at !== null && new Date(row.due_at).getTime() < Date.now()) throw new Error('LEARNING_ASSIGNMENT_DUE_DATE_PASSED');
  if (!row.allow_text && responseText !== '') throw new Error('LEARNING_ASSIGNMENT_TEXT_NOT_ALLOWED');
  if (!row.allow_attachments && attachmentAssetIds.length > 0) throw new Error('LEARNING_ASSIGNMENT_ATTACHMENTS_NOT_ALLOWED');
  if (attachmentAssetIds.length > row.max_attachments) throw new Error('LEARNING_ASSIGNMENT_ATTACHMENTS_TOO_MANY');
  if (row.allow_text && responseText === '' && attachmentAssetIds.length === 0) throw new Error('LEARNING_ASSIGNMENT_RESPONSE_REQUIRED');
  if (!row.allow_text && attachmentAssetIds.length === 0) throw new Error('LEARNING_ASSIGNMENT_ATTACHMENT_REQUIRED');

  if (attachmentAssetIds.length > 0) {
    const assets = await client.query<{ readonly asset_id: string }>(
      `SELECT asset_id FROM platform.content_assets
        WHERE tenant_id = $1::uuid AND asset_id = ANY($2::uuid[])
          AND purpose = 'LEARNING_SUBMISSION' AND state = 'AVAILABLE'
          AND created_by_subject_id = $3`,
      [input.tenantId, attachmentAssetIds, input.subjectId],
    );
    if (assets.rows.length !== attachmentAssetIds.length) throw new Error('LEARNING_ASSIGNMENT_ATTACHMENT_NOT_AVAILABLE');
  }

  const existing = await client.query<SubmissionRow>(
    `SELECT ${SUBMISSION_SELECT}
       FROM platform.learning_assignment_submissions submission
       JOIN platform.learning_assignment_versions version
         ON version.assignment_version_id = submission.assignment_version_id AND version.tenant_id = submission.tenant_id
       JOIN platform.learning_assignments assignment
         ON assignment.assignment_id = submission.assignment_id AND assignment.tenant_id = submission.tenant_id
      WHERE submission.tenant_id = $1::uuid AND submission.submission_key = $2`,
    [input.tenantId, input.submissionKey],
  );
  if (existing.rows[0]) return project(existing.rows[0]);

  const attempt = await client.query<{ readonly next_attempt: number }>(
    `SELECT COALESCE(max(attempt_number), 0) + 1 AS next_attempt
       FROM platform.learning_assignment_submissions
      WHERE tenant_id = $1::uuid AND learner_id = $2::uuid AND assignment_version_id = $3::uuid`,
    [input.tenantId, row.learner_id, row.assignment_version_id],
  );
  const inserted = await client.query<SubmissionRow>(
    `INSERT INTO platform.learning_assignment_submissions (
       tenant_id, assignment_id, assignment_version_id, learner_id, enrollment_id,
       course_version_id, lesson_id, submission_key, attempt_number, response_text
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10)
     RETURNING submission_id, assignment_version_id, $11 AS assignment_key, $12 AS title,
       learner_id, enrollment_id, lesson_id, attempt_number, status, response_text,
       score_points, $13::numeric AS max_points, feedback, submitted_at, graded_at`,
    [input.tenantId, row.assignment_id, row.assignment_version_id, row.learner_id,
      input.enrollmentId, row.course_version_id, input.lessonId, input.submissionKey,
      attempt.rows[0]?.next_attempt ?? 1, responseText, input.assignmentKey, row.title, row.max_points],
  );
  const submission = inserted.rows[0];
  if (!submission) throw new Error('LEARNING_ASSIGNMENT_SUBMISSION_INSERT_FAILED');

  if (attachmentAssetIds.length > 0) {
    await client.query(
      `INSERT INTO platform.learning_assignment_submission_assets (
         submission_id, tenant_id, asset_id, organization_id, position
       )
       SELECT $1::uuid, asset.tenant_id, asset.asset_id, asset.organization_id, ordinal::integer
         FROM unnest($2::uuid[]) WITH ORDINALITY AS selected(asset_id, ordinal)
         JOIN platform.content_assets asset ON asset.asset_id = selected.asset_id
        WHERE asset.tenant_id = $3::uuid`,
      [submission.submission_id, attachmentAssetIds, input.tenantId],
    );
  }

  await appendDomainEventWithOutbox(client, { event: {
    eventId: randomUUID(), tenantId: input.tenantId, aggregateType: 'learning.assignment.submission',
    aggregateId: submission.submission_id, eventType: 'learning.assignment.submitted', eventVersion: 1,
    occurredAt: new Date(), actorSubjectId: input.subjectId, correlationId: input.correlationId,
    payload: { assignmentVersionId: row.assignment_version_id, enrollmentId: input.enrollmentId, lessonId: input.lessonId },
    metadata: { source: 'learning.assignment.learner' },
  }});
  return project(submission);
}

export async function gradeLearningAssignmentSubmission(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly submissionId: string;
    readonly actorSubjectId: string;
    readonly outcome: 'RETURNED' | 'GRADED';
    readonly scorePoints?: number;
    readonly feedback: string;
    readonly correlationId: string;
  },
): Promise<LearningAssignmentSubmission> {
  await requireLearning(client, input.tenantId);
  const loaded = await client.query<SubmissionRow>(
    `SELECT ${SUBMISSION_SELECT}
       FROM platform.learning_assignment_submissions submission
       JOIN platform.learning_assignment_versions version
         ON version.assignment_version_id = submission.assignment_version_id AND version.tenant_id = submission.tenant_id
       JOIN platform.learning_assignments assignment
         ON assignment.assignment_id = submission.assignment_id AND assignment.tenant_id = submission.tenant_id
      WHERE submission.tenant_id = $1::uuid AND submission.submission_id = $2::uuid FOR UPDATE OF submission`,
    [input.tenantId, input.submissionId],
  );
  const current = loaded.rows[0];
  if (!current) throw new Error('LEARNING_ASSIGNMENT_SUBMISSION_NOT_FOUND');
  if (!['SUBMITTED','RETURNED'].includes(current.status)) throw new Error('LEARNING_ASSIGNMENT_SUBMISSION_NOT_GRADABLE');
  const feedback = input.feedback.trim();
  if (input.outcome === 'RETURNED' && feedback === '') throw new Error('LEARNING_ASSIGNMENT_FEEDBACK_REQUIRED');
  const score = input.outcome === 'GRADED' ? input.scorePoints : undefined;
  if (score === undefined && input.outcome === 'GRADED') throw new Error('LEARNING_ASSIGNMENT_SCORE_REQUIRED');
  const maxPoints = Number(current.max_points);
  if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > maxPoints)) {
    throw new Error('LEARNING_ASSIGNMENT_SCORE_INVALID');
  }

  const updated = await client.query<SubmissionRow>(
    `UPDATE platform.learning_assignment_submissions submission SET
       status = $3, score_points = $4, feedback = $5, graded_at = now(),
       graded_by_subject_id = $6, updated_at = now()
     FROM platform.learning_assignment_versions version, platform.learning_assignments assignment
     WHERE submission.tenant_id = $1::uuid AND submission.submission_id = $2::uuid
       AND version.assignment_version_id = submission.assignment_version_id AND version.tenant_id = submission.tenant_id
       AND assignment.assignment_id = submission.assignment_id AND assignment.tenant_id = submission.tenant_id
     RETURNING ${SUBMISSION_SELECT}`,
    [input.tenantId, input.submissionId, input.outcome, score ?? null, feedback, input.actorSubjectId],
  );
  const next = updated.rows[0];
  if (!next) throw new Error('LEARNING_ASSIGNMENT_GRADE_UPDATE_FAILED');

  await client.query(
    `INSERT INTO platform.learning_assignment_grade_events (
       tenant_id, submission_id, from_status, to_status, score_points, feedback, actor_subject_id, correlation_id
     ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)`,
    [input.tenantId, input.submissionId, current.status, input.outcome, score ?? null, feedback, input.actorSubjectId, input.correlationId],
  );
  await appendDomainEventWithOutbox(client, { event: {
    eventId: randomUUID(), tenantId: input.tenantId, aggregateType: 'learning.assignment.submission',
    aggregateId: input.submissionId,
    eventType: input.outcome === 'GRADED' ? 'learning.assignment.graded' : 'learning.assignment.returned',
    eventVersion: 1, occurredAt: new Date(), actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId, payload: { scorePoints: score ?? null, maxPoints },
    metadata: { source: 'learning.assignment.grading' },
  }});
  if (input.outcome === 'GRADED') {
    await reconcileLearningEnrollmentCompletion(client, {
      tenantId: input.tenantId,
      enrollmentId: current.enrollment_id,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
    });
  }
  return project(next);
}

export async function listMyLearningAssignmentSubmissions(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string; readonly subjectIssuer: string | null },
): Promise<readonly LearningAssignmentSubmission[]> {
  await requireLearning(client, input.tenantId);
  const result = await client.query<SubmissionRow>(
    `SELECT ${SUBMISSION_SELECT}
       FROM platform.learning_assignment_submissions submission
       JOIN platform.learning_learners learner
         ON learner.learner_id = submission.learner_id AND learner.tenant_id = submission.tenant_id
        AND learner.subject_id = $2 AND learner.subject_issuer IS NOT DISTINCT FROM $3
        AND learner.status = 'ACTIVE'
       JOIN platform.learning_assignment_versions version
         ON version.assignment_version_id = submission.assignment_version_id AND version.tenant_id = submission.tenant_id
       JOIN platform.learning_assignments assignment
         ON assignment.assignment_id = submission.assignment_id AND assignment.tenant_id = submission.tenant_id
      WHERE submission.tenant_id = $1::uuid
      ORDER BY submission.submitted_at DESC, submission.submission_id`,
    [input.tenantId, input.subjectId, input.subjectIssuer],
  );
  return result.rows.map(project);
}

export async function listLearningAssignmentSubmissions(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningAssignmentSubmission[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<SubmissionRow>(
    `SELECT ${SUBMISSION_SELECT}
       FROM platform.learning_assignment_submissions submission
       JOIN platform.learning_assignment_versions version
         ON version.assignment_version_id = submission.assignment_version_id AND version.tenant_id = submission.tenant_id
       JOIN platform.learning_assignments assignment
         ON assignment.assignment_id = submission.assignment_id AND assignment.tenant_id = submission.tenant_id
      WHERE submission.tenant_id = $1::uuid
      ORDER BY submission.submitted_at DESC, submission.submission_id`,
    [tenantId],
  );
  return result.rows.map(project);
}


const ASSIGNMENT_KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface LearningAssignmentDefinition {
  readonly assignmentId: string;
  readonly assignmentVersionId: string;
  readonly assignmentKey: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly title: string;
  readonly instructions: string;
  readonly courseVersionId: string;
  readonly maxPoints: number;
  readonly dueAt: string | null;
}

export async function createLearningAssignment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly courseVersionId: string;
    readonly assignmentKey: string;
    readonly title: string;
    readonly instructions: string;
    readonly maxPoints: number;
    readonly dueAt?: string | null;
    readonly actorSubjectId: string;
  },
): Promise<LearningAssignmentDefinition> {
  await requireLearning(client, input.tenantId);
  const assignmentKey = input.assignmentKey.trim().toLowerCase();
  const title = input.title.trim();
  if (!ASSIGNMENT_KEY.test(assignmentKey)) throw new Error('LEARNING_ASSIGNMENT_KEY_INVALID');
  if (title === '' || title.length > 500) throw new Error('LEARNING_ASSIGNMENT_TITLE_INVALID');
  if (!Number.isFinite(input.maxPoints) || input.maxPoints <= 0 || input.maxPoints > 1_000_000) {
    throw new Error('LEARNING_ASSIGNMENT_MAX_POINTS_INVALID');
  }
  const course = await client.query<{ readonly academy_id: string }>(
    `SELECT course.academy_id
       FROM platform.learning_course_versions version
       JOIN platform.learning_courses course
         ON course.course_id = version.course_id AND course.tenant_id = version.tenant_id
      WHERE version.tenant_id = $1::uuid AND version.course_version_id = $2::uuid
        AND version.state = 'DRAFT' AND course.status = 'ACTIVE' FOR UPDATE OF version`,
    [input.tenantId, input.courseVersionId],
  );
  const academyId = course.rows[0]?.academy_id;
  if (!academyId) throw new Error('LEARNING_ASSIGNMENT_DRAFT_COURSE_REQUIRED');

  const assignment = await client.query<{ readonly assignment_id: string }>(
    `INSERT INTO platform.learning_assignments (
       tenant_id, academy_id, assignment_key, created_by_subject_id
     ) VALUES ($1::uuid,$2::uuid,$3,$4) RETURNING assignment_id`,
    [input.tenantId, academyId, assignmentKey, input.actorSubjectId],
  );
  const assignmentId = assignment.rows[0]?.assignment_id;
  if (!assignmentId) throw new Error('LEARNING_ASSIGNMENT_INSERT_FAILED');
  const version = await client.query<{ readonly assignment_version_id: string }>(
    `INSERT INTO platform.learning_assignment_versions (
       tenant_id, assignment_id, version, title, instructions, course_version_id,
       max_points, allow_text, allow_attachments, max_attachments, due_at,
       created_by_subject_id, updated_by_subject_id
     ) VALUES ($1::uuid,$2::uuid,1,$3,$4,$5::uuid,$6,true,false,0,$7,$8,$8)
     RETURNING assignment_version_id`,
    [input.tenantId, assignmentId, title, input.instructions.trim(), input.courseVersionId,
      input.maxPoints, input.dueAt ?? null, input.actorSubjectId],
  );
  const assignmentVersionId = version.rows[0]?.assignment_version_id;
  if (!assignmentVersionId) throw new Error('LEARNING_ASSIGNMENT_VERSION_INSERT_FAILED');
  return {
    assignmentId, assignmentVersionId, assignmentKey, version: 1, state: 'DRAFT',
    title, instructions: input.instructions.trim(), courseVersionId: input.courseVersionId,
    maxPoints: input.maxPoints, dueAt: input.dueAt ?? null,
  };
}

export async function publishLearningAssignmentVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly assignmentId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly assignmentVersionId: string; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);
  const loaded = await client.query<{
    readonly assignment_version_id: string; readonly assignment_key: string;
    readonly course_version_id: string; readonly state: LearningAssignmentDefinition['state'];
  }>(
    `SELECT version.assignment_version_id, assignment.assignment_key,
            version.course_version_id, version.state
       FROM platform.learning_assignments assignment
       JOIN platform.learning_assignment_versions version
         ON version.assignment_id = assignment.assignment_id AND version.tenant_id = assignment.tenant_id
      WHERE assignment.tenant_id = $1::uuid AND assignment.assignment_id = $2::uuid
        AND version.version = $3 AND assignment.status = 'ACTIVE' FOR UPDATE OF assignment, version`,
    [input.tenantId, input.assignmentId, input.version],
  );
  const target = loaded.rows[0];
  if (!target) throw new Error('LEARNING_ASSIGNMENT_VERSION_NOT_FOUND');
  if (target.state === 'PUBLISHED') return { assignmentVersionId: target.assignment_version_id, idempotent: true };
  if (target.state !== 'DRAFT') throw new Error('LEARNING_ASSIGNMENT_VERSION_NOT_PUBLISHABLE');

  const reference = await client.query(
    `SELECT 1 FROM platform.learning_lessons lesson
      WHERE lesson.tenant_id = $1::uuid AND lesson.course_version_id = $2::uuid
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(lesson.content->'blocks') = 'array'
              THEN lesson.content->'blocks' ELSE '[]'::jsonb END
          ) block WHERE block->>'type' = 'ASSIGNMENT'
            AND block->'data'->>'definitionId' = $3
        ) LIMIT 1`,
    [input.tenantId, target.course_version_id, target.assignment_key],
  );
  if (!reference.rows[0]) throw new Error('LEARNING_ASSIGNMENT_BLOCK_REFERENCE_REQUIRED');

  await client.query(
    `UPDATE platform.learning_assignment_versions SET state='PUBLISHED',
       published_by_subject_id=$4, published_at=now(), updated_by_subject_id=$4, updated_at=now()
      WHERE tenant_id=$1::uuid AND assignment_id=$2::uuid AND version=$3`,
    [input.tenantId, input.assignmentId, input.version, input.actorSubjectId],
  );
  await client.query(
    `UPDATE platform.learning_assignments SET current_published_version=$3, updated_at=now()
      WHERE tenant_id=$1::uuid AND assignment_id=$2::uuid`,
    [input.tenantId, input.assignmentId, input.version],
  );
  await appendDomainEventWithOutbox(client, { event: {
    eventId: randomUUID(), tenantId: input.tenantId, aggregateType: 'learning.assignment',
    aggregateId: input.assignmentId, eventType: 'learning.assignment.version.published', eventVersion: 1,
    occurredAt: new Date(), actorSubjectId: input.actorSubjectId, correlationId: input.correlationId,
    payload: { assignmentVersionId: target.assignment_version_id, version: input.version, courseVersionId: target.course_version_id },
    metadata: { source: 'learning.assignment.authoring' },
  }});
  return { assignmentVersionId: target.assignment_version_id, idempotent: false };
}


export async function authorizeMyLearningAssignmentAttachment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly enrollmentId: string;
    readonly lessonId: string;
    readonly assignmentKey: string;
  },
): Promise<void> {
  await requireLearning(client, input.tenantId);
  const result = await client.query(
    `SELECT 1
       FROM platform.learning_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id=enrollment.learner_id AND learner.tenant_id=enrollment.tenant_id
        AND learner.subject_id=$3 AND learner.subject_issuer IS NOT DISTINCT FROM $4
        AND learner.status='ACTIVE'
       JOIN platform.learning_lessons lesson
         ON lesson.lesson_id=$5::uuid AND lesson.tenant_id=enrollment.tenant_id
        AND lesson.course_version_id=enrollment.course_version_id
       JOIN platform.learning_assignments assignment
         ON assignment.tenant_id=enrollment.tenant_id AND assignment.assignment_key=$6
        AND assignment.status='ACTIVE'
       JOIN platform.learning_assignment_versions version
         ON version.assignment_id=assignment.assignment_id AND version.tenant_id=assignment.tenant_id
        AND version.course_version_id=enrollment.course_version_id
        AND version.state='PUBLISHED' AND version.allow_attachments=true
      WHERE enrollment.tenant_id=$1::uuid AND enrollment.enrollment_id=$2::uuid
        AND enrollment.status IN ('ASSIGNED','IN_PROGRESS')
        AND (version.due_at IS NULL OR version.due_at >= now())
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(lesson.content->'blocks')='array'
              THEN lesson.content->'blocks' ELSE '[]'::jsonb END
          ) block WHERE block->>'type'='ASSIGNMENT'
            AND block->'data'->>'definitionId'=assignment.assignment_key
        ) LIMIT 1`,
    [input.tenantId,input.enrollmentId,input.subjectId,input.subjectIssuer,input.lessonId,input.assignmentKey],
  );
  if (!result.rows[0]) throw new Error('LEARNING_ASSIGNMENT_ATTACHMENT_FORBIDDEN');
}
