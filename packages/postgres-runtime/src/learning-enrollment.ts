import { randomUUID } from 'node:crypto';
import {
  completionPercent,
  enrollmentAllowsProgress,
  validateLearningEnrollmentInput,
  validateLearningLearnerInput,
  type EnrollmentSource,
  type EnrollmentStatus,
  type LearnerAudienceType,
  type LearningActivityType,
} from '@expadio/learning';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { requireTenantModuleOperational } from './product-module.ts';

interface LearnerRow {
  readonly learner_id: string;
  readonly subject_id: string | null;
  readonly contact_id: string | null;
  readonly external_ref: string | null;
  readonly full_name: string;
  readonly email: string | null;
  readonly audience_type: LearnerAudienceType;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  readonly metadata: Record<string, unknown>;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface EnrollmentRow {
  readonly enrollment_id: string;
  readonly learner_id: string;
  readonly course_id: string;
  readonly course_version_id: string;
  readonly assignment_key: string;
  readonly source_type: EnrollmentSource;
  readonly source_ref: string | null;
  readonly status: EnrollmentStatus;
  readonly assigned_by_subject_id: string;
  readonly assigned_at: Date | string;
  readonly due_at: Date | string | null;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly completion_percent: string | number;
  readonly last_activity_at: Date | string | null;
}

interface EnrollmentListRow extends EnrollmentRow {
  readonly learner_name: string;
  readonly course_key: string;
  readonly course_version: number;
  readonly course_title: string;
}

interface SelfLessonRow {
  readonly enrollment_id: string;
  readonly lesson_id: string;
  readonly lesson_key: string;
  readonly title: string;
  readonly activity_type: LearningActivityType;
  readonly required: boolean;
  readonly position: number;
  readonly module_position: number;
  readonly progress_status: 'IN_PROGRESS' | 'COMPLETED' | null;
  readonly progress_percent: string | number | null;
  readonly completed_at: Date | string | null;
}

export interface LearningLearner {
  readonly learnerId: string;
  readonly subjectId: string | null;
  readonly contactId: string | null;
  readonly externalRef: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly audienceType: LearnerAudienceType;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LearningEnrollmentSummary {
  readonly enrollmentId: string;
  readonly learnerId: string;
  readonly learnerName: string;
  readonly assignmentKey: string;
  readonly courseId: string;
  readonly courseKey: string;
  readonly courseVersionId: string;
  readonly courseVersion: number;
  readonly courseTitle: string;
  readonly sourceType: EnrollmentSource;
  readonly sourceRef: string | null;
  readonly status: EnrollmentStatus;
  readonly assignedBySubjectId: string;
  readonly assignedAt: string;
  readonly dueAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly completionPercent: number;
  readonly lastActivityAt: string | null;
}

export interface SelfLearningEnrollment extends LearningEnrollmentSummary {
  readonly lessons: readonly {
    readonly lessonId: string;
    readonly lessonKey: string;
    readonly title: string;
    readonly activityType: LearningActivityType;
    readonly required: boolean;
    readonly progressStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
    readonly progressPercent: number;
    readonly completedAt: string | null;
  }[];
}

export interface LearningTranscriptEntry {
  readonly enrollmentId: string;
  readonly courseId: string;
  readonly courseKey: string;
  readonly courseVersion: number;
  readonly courseTitle: string;
  readonly completedAt: string;
  readonly assignedAt: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function number(value: string | number | null): number {
  if (value === null) return 0;
  return Number(value);
}

async function requireLearning(client: PostgresClient, tenantId: string): Promise<void> {
  await requireTenantModuleOperational(client, { tenantId, moduleKey: 'learning' });
}

function learner(row: LearnerRow): LearningLearner {
  return {
    learnerId: row.learner_id,
    subjectId: row.subject_id,
    contactId: row.contact_id,
    externalRef: row.external_ref,
    fullName: row.full_name,
    email: row.email,
    audienceType: row.audience_type,
    status: row.status,
    metadata: { ...row.metadata },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function enrollment(row: EnrollmentListRow): LearningEnrollmentSummary {
  return {
    enrollmentId: row.enrollment_id,
    learnerId: row.learner_id,
    learnerName: row.learner_name,
    assignmentKey: row.assignment_key,
    courseId: row.course_id,
    courseKey: row.course_key,
    courseVersionId: row.course_version_id,
    courseVersion: row.course_version,
    courseTitle: row.course_title,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    status: row.status,
    assignedBySubjectId: row.assigned_by_subject_id,
    assignedAt: iso(row.assigned_at),
    dueAt: nullableIso(row.due_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    completionPercent: number(row.completion_percent),
    lastActivityAt: nullableIso(row.last_activity_at),
  };
}

export async function createLearningLearner(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly learner: unknown;
  },
): Promise<LearningLearner> {
  await requireLearning(client, input.tenantId);
  const value = validateLearningLearnerInput(input.learner);

  try {
    const result = await client.query<LearnerRow>(
      `INSERT INTO platform.learning_learners (
         tenant_id, subject_id, contact_id, external_ref, full_name, email,
         audience_type, metadata, created_by_subject_id
       ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING learner_id, subject_id, contact_id, external_ref, full_name,
                 email, audience_type, status, metadata, created_at, updated_at`,
      [
        input.tenantId,
        value.subjectId,
        value.contactId,
        value.externalRef,
        value.fullName,
        value.email,
        value.audienceType,
        JSON.stringify(value.metadata),
        input.actorSubjectId,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('LEARNING_LEARNER_INSERT_FAILED');
    return learner(row);
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_LEARNER_IDENTITY_EXISTS');
    if (error?.code === '23503') throw new Error('LEARNING_LEARNER_CONTACT_NOT_FOUND');
    throw error;
  }
}

export async function listLearningLearners(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningLearner[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<LearnerRow>(
    `SELECT learner_id, subject_id, contact_id, external_ref, full_name, email,
            audience_type, status, metadata, created_at, updated_at
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
      ORDER BY full_name, learner_id`,
    [tenantId],
  );
  return result.rows.map(learner);
}

export async function createLearningEnrollment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly enrollment: unknown;
  },
): Promise<{ readonly enrollment: LearningEnrollmentSummary; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);
  const value = validateLearningEnrollmentInput(input.enrollment);

  const existing = await loadEnrollmentByAssignmentKey(client, input.tenantId, value.assignmentKey);
  if (existing !== null) {
    if (
      existing.learnerId !== value.learnerId
      || existing.courseId !== value.courseId
      || existing.sourceType !== value.sourceType
      || existing.sourceRef !== value.sourceRef
      || existing.dueAt !== value.dueAt
    ) {
      throw new Error('LEARNING_ASSIGNMENT_KEY_CONFLICT');
    }
    return { enrollment: existing, idempotent: true };
  }

  const learnerResult = await client.query<{ readonly status: string }>(
    `SELECT status
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid AND learner_id = $2::uuid`,
    [input.tenantId, value.learnerId],
  );
  const learnerState = learnerResult.rows[0]?.status;
  if (learnerState === undefined) throw new Error('LEARNING_LEARNER_NOT_FOUND');
  if (learnerState !== 'ACTIVE') throw new Error('LEARNING_LEARNER_NOT_ACTIVE');

  const courseResult = await client.query<{
    readonly course_version_id: string;
    readonly version: number;
    readonly course_key: string;
    readonly title: string;
  }>(
    `SELECT v.course_version_id, v.version, c.course_key, v.title
       FROM platform.learning_courses c
       JOIN platform.learning_course_versions v
         ON v.course_id = c.course_id
        AND v.tenant_id = c.tenant_id
        AND v.version = c.current_published_version
        AND v.state = 'PUBLISHED'
      WHERE c.tenant_id = $1::uuid
        AND c.course_id = $2::uuid
        AND c.status = 'ACTIVE'`,
    [input.tenantId, value.courseId],
  );
  const course = courseResult.rows[0];
  if (course === undefined) throw new Error('LEARNING_COURSE_NOT_PUBLISHED');

  try {
    await client.query(
      `INSERT INTO platform.learning_enrollments (
         tenant_id, learner_id, course_id, course_version_id, assignment_key,
         source_type, source_ref, assigned_by_subject_id, due_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6, $7, $8, $9
       )`,
      [
        input.tenantId,
        value.learnerId,
        value.courseId,
        course.course_version_id,
        value.assignmentKey,
        value.sourceType,
        value.sourceRef,
        input.actorSubjectId,
        value.dueAt,
      ],
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      const replay = await loadEnrollmentByAssignmentKey(client, input.tenantId, value.assignmentKey);
      if (replay !== null) return { enrollment: replay, idempotent: true };
    }
    throw error;
  }

  const created = await loadEnrollmentByAssignmentKey(client, input.tenantId, value.assignmentKey);
  if (created === null) throw new Error('LEARNING_ENROLLMENT_INSERT_FAILED');

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.enrollment',
      aggregateId: created.enrollmentId,
      eventType: 'learning.enrollment.created',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        learnerId: value.learnerId,
        courseId: value.courseId,
        courseVersionId: course.course_version_id,
        courseVersion: course.version,
        assignmentKey: value.assignmentKey,
        sourceType: value.sourceType,
      },
      metadata: { source: 'learning.enrollment.assignment' },
    },
  });

  return { enrollment: created, idempotent: false };
}

export async function listLearningEnrollments(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly learnerId?: string },
): Promise<readonly LearningEnrollmentSummary[]> {
  await requireLearning(client, input.tenantId);
  const result = await client.query<EnrollmentListRow>(
    `SELECT e.*, l.full_name AS learner_name, c.course_key,
            v.version AS course_version, v.title AS course_title
       FROM platform.learning_enrollments e
       JOIN platform.learning_learners l
         ON l.learner_id = e.learner_id AND l.tenant_id = e.tenant_id
       JOIN platform.learning_courses c
         ON c.course_id = e.course_id AND c.tenant_id = e.tenant_id
       JOIN platform.learning_course_versions v
         ON v.course_version_id = e.course_version_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1::uuid
        AND ($2::uuid IS NULL OR e.learner_id = $2::uuid)
      ORDER BY e.assigned_at DESC, e.enrollment_id`,
    [input.tenantId, input.learnerId ?? null],
  );
  return result.rows.map(enrollment);
}

export async function listMyLearningEnrollments(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string },
): Promise<{
  readonly learner: LearningLearner | null;
  readonly enrollments: readonly SelfLearningEnrollment[];
}> {
  await requireLearning(client, input.tenantId);
  const learnerResult = await client.query<LearnerRow>(
    `SELECT learner_id, subject_id, contact_id, external_ref, full_name, email,
            audience_type, status, metadata, created_at, updated_at
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
        AND subject_id = $2
        AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.subjectId],
  );
  const learnerRow = learnerResult.rows[0];
  if (learnerRow === undefined) return { learner: null, enrollments: [] };

  const enrollments = await listLearningEnrollments(client, {
    tenantId: input.tenantId,
    learnerId: learnerRow.learner_id,
  });

  if (enrollments.length === 0) {
    return { learner: learner(learnerRow), enrollments: [] };
  }

  const ids = enrollments.map((item) => item.enrollmentId);
  const lessons = await client.query<SelfLessonRow>(
    `SELECT e.enrollment_id, lesson.lesson_id, lesson.lesson_key, lesson.title,
            lesson.activity_type, lesson.required, lesson.position,
            module.position AS module_position,
            progress.status AS progress_status,
            progress.progress_percent,
            progress.completed_at
       FROM platform.learning_enrollments e
       JOIN platform.learning_course_modules module
         ON module.course_version_id = e.course_version_id
        AND module.tenant_id = e.tenant_id
       JOIN platform.learning_lessons lesson
         ON lesson.course_module_id = module.course_module_id
        AND lesson.course_version_id = e.course_version_id
        AND lesson.tenant_id = e.tenant_id
       LEFT JOIN platform.learning_lesson_progress progress
         ON progress.enrollment_id = e.enrollment_id
        AND progress.lesson_id = lesson.lesson_id
        AND progress.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1::uuid
        AND e.enrollment_id = ANY($2::uuid[])
      ORDER BY e.enrollment_id, module.position, lesson.position`,
    [input.tenantId, ids],
  );

  const byEnrollment = new Map<string, SelfLessonRow[]>();
  for (const row of lessons.rows) {
    const current = byEnrollment.get(row.enrollment_id) ?? [];
    current.push(row);
    byEnrollment.set(row.enrollment_id, current);
  }

  return {
    learner: learner(learnerRow),
    enrollments: enrollments.map((item) => ({
      ...item,
      lessons: (byEnrollment.get(item.enrollmentId) ?? []).map((row) => ({
        lessonId: row.lesson_id,
        lessonKey: row.lesson_key,
        title: row.title,
        activityType: row.activity_type,
        required: row.required,
        progressStatus: row.progress_status ?? 'NOT_STARTED',
        progressPercent: number(row.progress_percent),
        completedAt: nullableIso(row.completed_at),
      })),
    })),
  };
}

export async function completeMyLearningLesson(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly enrollmentId: string;
    readonly lessonId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly enrollmentId: string;
  readonly lessonId: string;
  readonly enrollmentStatus: EnrollmentStatus;
  readonly completionPercent: number;
  readonly courseCompleted: boolean;
  readonly idempotent: boolean;
}> {
  await requireLearning(client, input.tenantId);

  const locked = await client.query<EnrollmentRow & {
    readonly course_key: string;
    readonly course_version: number;
  }>(
    `SELECT e.*, c.course_key, v.version AS course_version
       FROM platform.learning_enrollments e
       JOIN platform.learning_learners l
         ON l.learner_id = e.learner_id
        AND l.tenant_id = e.tenant_id
        AND l.subject_id = $3
        AND l.status = 'ACTIVE'
       JOIN platform.learning_courses c
         ON c.course_id = e.course_id AND c.tenant_id = e.tenant_id
       JOIN platform.learning_course_versions v
         ON v.course_version_id = e.course_version_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1::uuid
        AND e.enrollment_id = $2::uuid
      FOR UPDATE OF e`,
    [input.tenantId, input.enrollmentId, input.subjectId],
  );
  const enrollmentRow = locked.rows[0];
  if (enrollmentRow === undefined) throw new Error('LEARNING_ENROLLMENT_NOT_FOUND');

  const existingProgress = await client.query<{
    readonly status: 'IN_PROGRESS' | 'COMPLETED';
  }>(
    `SELECT status
       FROM platform.learning_lesson_progress
      WHERE tenant_id = $1::uuid
        AND enrollment_id = $2::uuid
        AND lesson_id = $3::uuid`,
    [input.tenantId, input.enrollmentId, input.lessonId],
  );

  if (existingProgress.rows[0]?.status === 'COMPLETED') {
    return {
      enrollmentId: input.enrollmentId,
      lessonId: input.lessonId,
      enrollmentStatus: enrollmentRow.status,
      completionPercent: number(enrollmentRow.completion_percent),
      courseCompleted: enrollmentRow.status === 'COMPLETED',
      idempotent: true,
    };
  }

  if (!enrollmentAllowsProgress(enrollmentRow.status)) {
    throw new Error('LEARNING_ENROLLMENT_NOT_PROGRESSABLE');
  }

  const lessonResult = await client.query<{ readonly required: boolean }>(
    `SELECT required
       FROM platform.learning_lessons
      WHERE tenant_id = $1::uuid
        AND lesson_id = $2::uuid
        AND course_version_id = $3::uuid`,
    [input.tenantId, input.lessonId, enrollmentRow.course_version_id],
  );
  if (lessonResult.rows[0] === undefined) throw new Error('LEARNING_LESSON_NOT_IN_ENROLLMENT');

  const now = new Date();

  await client.query(
    `INSERT INTO platform.learning_lesson_progress (
       tenant_id, enrollment_id, course_version_id, lesson_id,
       status, progress_percent, completed_at, updated_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'COMPLETED', 100, $5, $6
     )
     ON CONFLICT (enrollment_id, lesson_id)
     DO UPDATE SET
       status = 'COMPLETED',
       progress_percent = 100,
       completed_at = EXCLUDED.completed_at,
       updated_by_subject_id = EXCLUDED.updated_by_subject_id,
       updated_at = now()`,
    [
      input.tenantId,
      input.enrollmentId,
      enrollmentRow.course_version_id,
      input.lessonId,
      now,
      input.subjectId,
    ],
  );

  const startedNow = enrollmentRow.status === 'ASSIGNED';
  if (startedNow) {
    await client.query(
      `UPDATE platform.learning_enrollments
          SET status = 'IN_PROGRESS',
              started_at = COALESCE(started_at, $3),
              last_activity_at = $3,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND enrollment_id = $2::uuid`,
      [input.tenantId, input.enrollmentId, now],
    );

    await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'learning.enrollment',
        aggregateId: input.enrollmentId,
        eventType: 'learning.course.started',
        eventVersion: 1,
        occurredAt: now,
        actorSubjectId: input.subjectId,
        correlationId: input.correlationId,
        payload: {
          learnerId: enrollmentRow.learner_id,
          courseId: enrollmentRow.course_id,
          courseVersion: enrollmentRow.course_version,
        },
        metadata: { source: 'learning.progress' },
      },
    });
  }

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.enrollment',
      aggregateId: input.enrollmentId,
      eventType: 'learning.lesson.completed',
      eventVersion: 1,
      occurredAt: now,
      actorSubjectId: input.subjectId,
      correlationId: input.correlationId,
      payload: {
        learnerId: enrollmentRow.learner_id,
        courseId: enrollmentRow.course_id,
        courseVersion: enrollmentRow.course_version,
        lessonId: input.lessonId,
      },
      metadata: { source: 'learning.progress' },
    },
  });

  const counts = await client.query<{
    readonly required_count: string | number;
    readonly total_count: string | number;
    readonly completed_required_count: string | number;
    readonly completed_total_count: string | number;
  }>(
    `SELECT
       count(*) FILTER (WHERE lesson.required) AS required_count,
       count(*) AS total_count,
       count(*) FILTER (
         WHERE lesson.required AND progress.status = 'COMPLETED'
       ) AS completed_required_count,
       count(*) FILTER (
         WHERE progress.status = 'COMPLETED'
       ) AS completed_total_count
     FROM platform.learning_lessons lesson
     LEFT JOIN platform.learning_lesson_progress progress
       ON progress.lesson_id = lesson.lesson_id
      AND progress.enrollment_id = $2::uuid
      AND progress.tenant_id = lesson.tenant_id
     WHERE lesson.tenant_id = $1::uuid
       AND lesson.course_version_id = $3::uuid`,
    [input.tenantId, input.enrollmentId, enrollmentRow.course_version_id],
  );
  const count = counts.rows[0];
  if (count === undefined) throw new Error('LEARNING_PROGRESS_COUNT_FAILED');

  const requiredCount = number(count.required_count);
  const denominator = requiredCount > 0 ? requiredCount : number(count.total_count);
  const completedCount = requiredCount > 0
    ? number(count.completed_required_count)
    : number(count.completed_total_count);
  const percent = completionPercent(denominator, completedCount);
  const courseCompleted = denominator > 0 && completedCount >= denominator;

  if (courseCompleted) {
    await client.query(
      `UPDATE platform.learning_enrollments
          SET status = 'COMPLETED',
              completion_percent = 100,
              completed_at = COALESCE(completed_at, $3),
              last_activity_at = $3,
              started_at = COALESCE(started_at, $3),
              updated_at = now()
        WHERE tenant_id = $1::uuid AND enrollment_id = $2::uuid`,
      [input.tenantId, input.enrollmentId, now],
    );

    await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'learning.enrollment',
        aggregateId: input.enrollmentId,
        eventType: 'learning.course.completed',
        eventVersion: 1,
        occurredAt: now,
        actorSubjectId: input.subjectId,
        correlationId: input.correlationId,
        payload: {
          learnerId: enrollmentRow.learner_id,
          courseId: enrollmentRow.course_id,
          courseKey: enrollmentRow.course_key,
          courseVersionId: enrollmentRow.course_version_id,
          courseVersion: enrollmentRow.course_version,
          completionPercent: 100,
        },
        metadata: { source: 'learning.progress' },
      },
    });
  } else {
    await client.query(
      `UPDATE platform.learning_enrollments
          SET status = 'IN_PROGRESS',
              completion_percent = $3,
              last_activity_at = $4,
              started_at = COALESCE(started_at, $4),
              updated_at = now()
        WHERE tenant_id = $1::uuid AND enrollment_id = $2::uuid`,
      [input.tenantId, input.enrollmentId, percent, now],
    );
  }

  return {
    enrollmentId: input.enrollmentId,
    lessonId: input.lessonId,
    enrollmentStatus: courseCompleted ? 'COMPLETED' : 'IN_PROGRESS',
    completionPercent: courseCompleted ? 100 : percent,
    courseCompleted,
    idempotent: false,
  };
}

export async function loadMyLearningTranscript(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string },
): Promise<readonly LearningTranscriptEntry[]> {
  await requireLearning(client, input.tenantId);
  const result = await client.query<{
    readonly enrollment_id: string;
    readonly course_id: string;
    readonly course_key: string;
    readonly version: number;
    readonly title: string;
    readonly completed_at: Date | string;
    readonly assigned_at: Date | string;
  }>(
    `SELECT e.enrollment_id, e.course_id, c.course_key,
            v.version, v.title, e.completed_at, e.assigned_at
       FROM platform.learning_enrollments e
       JOIN platform.learning_learners l
         ON l.learner_id = e.learner_id
        AND l.tenant_id = e.tenant_id
        AND l.subject_id = $2
       JOIN platform.learning_courses c
         ON c.course_id = e.course_id AND c.tenant_id = e.tenant_id
       JOIN platform.learning_course_versions v
         ON v.course_version_id = e.course_version_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1::uuid
        AND e.status = 'COMPLETED'
        AND e.completed_at IS NOT NULL
      ORDER BY e.completed_at DESC, e.enrollment_id`,
    [input.tenantId, input.subjectId],
  );

  return result.rows.map((row) => ({
    enrollmentId: row.enrollment_id,
    courseId: row.course_id,
    courseKey: row.course_key,
    courseVersion: row.version,
    courseTitle: row.title,
    completedAt: iso(row.completed_at),
    assignedAt: iso(row.assigned_at),
  }));
}

async function loadEnrollmentByAssignmentKey(
  client: PostgresClient,
  tenantId: string,
  assignmentKey: string,
): Promise<LearningEnrollmentSummary | null> {
  const result = await client.query<EnrollmentListRow>(
    `SELECT e.*, l.full_name AS learner_name, c.course_key,
            v.version AS course_version, v.title AS course_title
       FROM platform.learning_enrollments e
       JOIN platform.learning_learners l
         ON l.learner_id = e.learner_id AND l.tenant_id = e.tenant_id
       JOIN platform.learning_courses c
         ON c.course_id = e.course_id AND c.tenant_id = e.tenant_id
       JOIN platform.learning_course_versions v
         ON v.course_version_id = e.course_version_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1::uuid AND e.assignment_key = $2
      LIMIT 1`,
    [tenantId, assignmentKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : enrollment(row);
}
