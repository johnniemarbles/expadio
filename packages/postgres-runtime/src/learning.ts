import { randomUUID } from 'node:crypto';
import {
  assertCoursePublishable,
  validateCourseDraft,
  validateCourseKey,
  type CourseVersionState,
  type LearningActivityType,
  type ValidatedCourseDraft,
} from '@expadio/learning';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { requireTenantModuleOperational } from './product-module.ts';

interface CourseRow {
  readonly course_id: string;
  readonly tenant_id: string;
  readonly academy_id: string;
  readonly course_key: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly current_published_version: number | null;
  readonly created_by_subject_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface CourseVersionRow {
  readonly course_version_id: string;
  readonly tenant_id: string;
  readonly course_id: string;
  readonly version: number;
  readonly state: CourseVersionState;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly language: string;
  readonly visibility: 'PRIVATE' | 'TENANT' | 'PUBLIC';
  readonly enrollment_mode: 'OPEN' | 'ASSIGNED_ONLY' | 'APPROVAL_REQUIRED';
  readonly certificate_enabled: boolean;
  readonly passing_score: number | null;
  readonly estimated_minutes: number | null;
  readonly learning_objectives: readonly string[];
  readonly created_by_subject_id: string;
  readonly created_at: Date | string;
  readonly updated_by_subject_id: string;
  readonly updated_at: Date | string;
  readonly published_by_subject_id: string | null;
  readonly published_at: Date | string | null;
}

interface ModuleRow {
  readonly course_module_id: string;
  readonly module_key: string;
  readonly title: string;
  readonly position: number;
}

interface LessonRow {
  readonly lesson_id: string;
  readonly course_module_id: string;
  readonly lesson_key: string;
  readonly title: string;
  readonly activity_type: LearningActivityType;
  readonly position: number;
  readonly required: boolean;
  readonly estimated_minutes: number | null;
  readonly content: Record<string, unknown>;
}

export interface LearningCourseVersion {
  readonly courseVersionId: string;
  readonly courseId: string;
  readonly version: number;
  readonly state: CourseVersionState;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly language: string;
  readonly visibility: 'PRIVATE' | 'TENANT' | 'PUBLIC';
  readonly enrollmentMode: 'OPEN' | 'ASSIGNED_ONLY' | 'APPROVAL_REQUIRED';
  readonly certificateEnabled: boolean;
  readonly passingScore: number | null;
  readonly estimatedMinutes: number | null;
  readonly learningObjectives: readonly string[];
  readonly createdBySubjectId: string;
  readonly createdAt: string;
  readonly updatedBySubjectId: string;
  readonly updatedAt: string;
  readonly publishedBySubjectId: string | null;
  readonly publishedAt: string | null;
  readonly modules: readonly {
    readonly courseModuleId: string;
    readonly moduleKey: string;
    readonly title: string;
    readonly position: number;
    readonly lessons: readonly {
      readonly lessonId: string;
      readonly lessonKey: string;
      readonly title: string;
      readonly activityType: LearningActivityType;
      readonly position: number;
      readonly required: boolean;
      readonly estimatedMinutes: number | null;
      readonly content: Readonly<Record<string, unknown>>;
    }[];
  }[];
}

export interface LearningCourseSummary {
  readonly courseId: string;
  readonly courseKey: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly currentPublishedVersion: number | null;
  readonly publishedTitle: string | null;
  readonly draftVersion: number | null;
  readonly draftTitle: string | null;
  readonly updatedAt: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

async function requireLearning(client: PostgresClient, tenantId: string): Promise<void> {
  await requireTenantModuleOperational(client, { tenantId, moduleKey: 'learning' });
}

async function defaultAcademyId(client: PostgresClient, tenantId: string): Promise<string> {
  const result = await client.query<{ readonly academy_id: string }>(
    "SELECT academy_id FROM platform.learning_academies " +
      "WHERE tenant_id = $1::uuid AND is_default = true AND status = 'ACTIVE' LIMIT 1",
    [tenantId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_DEFAULT_ACADEMY_MISSING');
  return row.academy_id;
}

export async function listLearningCourses(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningCourseSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly course_id: string;
    readonly course_key: string;
    readonly status: 'ACTIVE' | 'ARCHIVED';
    readonly current_published_version: number | null;
    readonly published_title: string | null;
    readonly draft_version: number | null;
    readonly draft_title: string | null;
    readonly updated_at: Date | string;
  }>(
    "SELECT c.course_id, c.course_key, c.status, c.current_published_version, " +
      "published.title AS published_title, draft.version AS draft_version, " +
      "draft.title AS draft_title, c.updated_at " +
      "FROM platform.learning_courses c " +
      "LEFT JOIN platform.learning_course_versions published " +
      "ON published.course_id = c.course_id AND published.state = 'PUBLISHED' " +
      "LEFT JOIN LATERAL (SELECT v.version, v.title FROM platform.learning_course_versions v " +
      "WHERE v.course_id = c.course_id AND v.state IN ('DRAFT','IN_REVIEW') " +
      "ORDER BY v.version DESC LIMIT 1) draft ON true " +
      "WHERE c.tenant_id = $1::uuid ORDER BY c.updated_at DESC, c.course_key",
    [tenantId],
  );
  return result.rows.map((row) => ({
    courseId: row.course_id,
    courseKey: row.course_key,
    status: row.status,
    currentPublishedVersion: row.current_published_version,
    publishedTitle: row.published_title,
    draftVersion: row.draft_version,
    draftTitle: row.draft_title,
    updatedAt: iso(row.updated_at),
  }));
}

export async function createLearningCourse(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly courseKey: unknown;
    readonly draft: unknown;
  },
): Promise<{ readonly courseId: string; readonly courseKey: string; readonly version: LearningCourseVersion }> {
  await requireLearning(client, input.tenantId);
  const courseKey = validateCourseKey(input.courseKey);
  const draft = validateCourseDraft(input.draft);
  const academyId = await defaultAcademyId(client, input.tenantId);

  try {
    const courseResult = await client.query<CourseRow>(
      "INSERT INTO platform.learning_courses " +
        "(tenant_id, academy_id, course_key, created_by_subject_id) " +
        "VALUES ($1::uuid, $2::uuid, $3, $4) " +
        "RETURNING course_id, tenant_id, academy_id, course_key, status, " +
        "current_published_version, created_by_subject_id, created_at, updated_at",
      [input.tenantId, academyId, courseKey, input.actorSubjectId],
    );
    const course = courseResult.rows[0];
    if (course === undefined) throw new Error('LEARNING_COURSE_INSERT_FAILED');

    const versionResult = await client.query<CourseVersionRow>(
      "INSERT INTO platform.learning_course_versions " +
        "(tenant_id, course_id, version, state, title, summary, description, language, " +
        "visibility, enrollment_mode, certificate_enabled, passing_score, estimated_minutes, " +
        "learning_objectives, created_by_subject_id, updated_by_subject_id) " +
        "VALUES ($1::uuid, $2::uuid, 1, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $13) " +
        "RETURNING *",
      [
        input.tenantId,
        course.course_id,
        draft.title,
        draft.summary,
        draft.description,
        draft.language,
        draft.visibility,
        draft.enrollmentMode,
        draft.certificateEnabled,
        draft.passingScore,
        draft.estimatedMinutes,
        JSON.stringify(draft.learningObjectives),
        input.actorSubjectId,
      ],
    );
    const version = versionResult.rows[0];
    if (version === undefined) throw new Error('LEARNING_COURSE_VERSION_INSERT_FAILED');
    await insertStructure(client, input.tenantId, version.course_version_id, draft);

    await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'learning.course',
        aggregateId: course.course_id,
        eventType: 'learning.course.created',
        eventVersion: 1,
        occurredAt: new Date(),
        actorSubjectId: input.actorSubjectId,
        correlationId: input.correlationId,
        payload: { courseKey, courseVersion: 1, academyId },
        metadata: { source: 'learning.course.authoring' },
      },
    });

    return {
      courseId: course.course_id,
      courseKey,
      version: await loadLearningCourseVersion(client, {
        tenantId: input.tenantId,
        courseId: course.course_id,
        version: 1,
        skipOperationalCheck: true,
      }),
    };
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_COURSE_KEY_EXISTS');
    throw error;
  }
}

export async function loadLearningCourseVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly courseId: string;
    readonly version: number;
    readonly skipOperationalCheck?: boolean;
  },
): Promise<LearningCourseVersion> {
  if (input.skipOperationalCheck !== true) await requireLearning(client, input.tenantId);

  const versionResult = await client.query<CourseVersionRow>(
    "SELECT * FROM platform.learning_course_versions " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND version = $3",
    [input.tenantId, input.courseId, input.version],
  );
  const version = versionResult.rows[0];
  if (version === undefined) throw new Error('LEARNING_COURSE_VERSION_NOT_FOUND');

  const modules = await client.query<ModuleRow>(
    "SELECT course_module_id, module_key, title, position FROM platform.learning_course_modules " +
      "WHERE tenant_id = $1::uuid AND course_version_id = $2::uuid ORDER BY position",
    [input.tenantId, version.course_version_id],
  );
  const lessons = await client.query<LessonRow>(
    "SELECT lesson_id, course_module_id, lesson_key, title, activity_type, position, " +
      "required, estimated_minutes, content FROM platform.learning_lessons " +
      "WHERE tenant_id = $1::uuid AND course_version_id = $2::uuid " +
      "ORDER BY course_module_id, position",
    [input.tenantId, version.course_version_id],
  );

  const byModule = new Map<string, LessonRow[]>();
  for (const lesson of lessons.rows) {
    const list = byModule.get(lesson.course_module_id) ?? [];
    list.push(lesson);
    byModule.set(lesson.course_module_id, list);
  }

  return {
    courseVersionId: version.course_version_id,
    courseId: version.course_id,
    version: version.version,
    state: version.state,
    title: version.title,
    summary: version.summary,
    description: version.description,
    language: version.language,
    visibility: version.visibility,
    enrollmentMode: version.enrollment_mode,
    certificateEnabled: version.certificate_enabled,
    passingScore: version.passing_score,
    estimatedMinutes: version.estimated_minutes,
    learningObjectives: [...version.learning_objectives],
    createdBySubjectId: version.created_by_subject_id,
    createdAt: iso(version.created_at),
    updatedBySubjectId: version.updated_by_subject_id,
    updatedAt: iso(version.updated_at),
    publishedBySubjectId: version.published_by_subject_id,
    publishedAt: nullableIso(version.published_at),
    modules: modules.rows.map((module) => ({
      courseModuleId: module.course_module_id,
      moduleKey: module.module_key,
      title: module.title,
      position: module.position,
      lessons: (byModule.get(module.course_module_id) ?? []).map((lesson) => ({
        lessonId: lesson.lesson_id,
        lessonKey: lesson.lesson_key,
        title: lesson.title,
        activityType: lesson.activity_type,
        position: lesson.position,
        required: lesson.required,
        estimatedMinutes: lesson.estimated_minutes,
        content: { ...lesson.content },
      })),
    })),
  };
}

export async function replaceLearningCourseDraft(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly courseId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly draft: unknown;
  },
): Promise<LearningCourseVersion> {
  await requireLearning(client, input.tenantId);
  const draft = validateCourseDraft(input.draft);

  const locked = await client.query<CourseVersionRow>(
    "SELECT * FROM platform.learning_course_versions " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND version = $3 FOR UPDATE",
    [input.tenantId, input.courseId, input.version],
  );
  const row = locked.rows[0];
  if (row === undefined) throw new Error('LEARNING_COURSE_VERSION_NOT_FOUND');
  if (row.state !== 'DRAFT') throw new Error('LEARNING_COURSE_VERSION_IMMUTABLE');

  await client.query(
    "UPDATE platform.learning_course_versions SET title = $4, summary = $5, description = $6, " +
      "language = $7, visibility = $8, enrollment_mode = $9, certificate_enabled = $10, " +
      "passing_score = $11, estimated_minutes = $12, learning_objectives = $13::jsonb, " +
      "updated_by_subject_id = $14, updated_at = now() " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND version = $3",
    [
      input.tenantId,
      input.courseId,
      input.version,
      draft.title,
      draft.summary,
      draft.description,
      draft.language,
      draft.visibility,
      draft.enrollmentMode,
      draft.certificateEnabled,
      draft.passingScore,
      draft.estimatedMinutes,
      JSON.stringify(draft.learningObjectives),
      input.actorSubjectId,
    ],
  );
  await client.query(
    "DELETE FROM platform.learning_lessons WHERE tenant_id = $1::uuid AND course_version_id = $2::uuid",
    [input.tenantId, row.course_version_id],
  );
  await client.query(
    "DELETE FROM platform.learning_course_modules WHERE tenant_id = $1::uuid AND course_version_id = $2::uuid",
    [input.tenantId, row.course_version_id],
  );
  await insertStructure(client, input.tenantId, row.course_version_id, draft);
  await client.query(
    "UPDATE platform.learning_courses SET updated_at = now() " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid",
    [input.tenantId, input.courseId],
  );

  return loadLearningCourseVersion(client, {
    tenantId: input.tenantId,
    courseId: input.courseId,
    version: input.version,
    skipOperationalCheck: true,
  });
}

export async function clonePublishedLearningCourseVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly courseId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<LearningCourseVersion> {
  await requireLearning(client, input.tenantId);

  const courses = await client.query<CourseRow>(
    "SELECT course_id, tenant_id, academy_id, course_key, status, current_published_version, " +
      "created_by_subject_id, created_at, updated_at FROM platform.learning_courses " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid FOR UPDATE",
    [input.tenantId, input.courseId],
  );
  const course = courses.rows[0];
  if (course === undefined) throw new Error('LEARNING_COURSE_NOT_FOUND');

  const drafts = await client.query<{ readonly version: number }>(
    "SELECT version FROM platform.learning_course_versions " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND state IN ('DRAFT','IN_REVIEW') LIMIT 1",
    [input.tenantId, input.courseId],
  );
  if (drafts.rows[0] !== undefined) throw new Error('LEARNING_COURSE_DRAFT_ALREADY_EXISTS');
  if (course.current_published_version === null) throw new Error('LEARNING_COURSE_HAS_NO_PUBLISHED_VERSION');

  const source = await loadLearningCourseVersion(client, {
    tenantId: input.tenantId,
    courseId: input.courseId,
    version: course.current_published_version,
    skipOperationalCheck: true,
  });

  const seq = await client.query<{ readonly next_version: number }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM platform.learning_course_versions " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid",
    [input.tenantId, input.courseId],
  );
  const nextVersion = seq.rows[0]?.next_version;
  if (nextVersion === undefined) throw new Error('LEARNING_COURSE_VERSION_SEQUENCE_FAILED');

  const created = await client.query<CourseVersionRow>(
    "INSERT INTO platform.learning_course_versions " +
      "(tenant_id, course_id, version, state, title, summary, description, language, visibility, " +
      "enrollment_mode, certificate_enabled, passing_score, estimated_minutes, learning_objectives, " +
      "created_by_subject_id, updated_by_subject_id) " +
      "VALUES ($1::uuid, $2::uuid, $3, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $14) RETURNING *",
    [
      input.tenantId,
      input.courseId,
      nextVersion,
      source.title,
      source.summary,
      source.description,
      source.language,
      source.visibility,
      source.enrollmentMode,
      source.certificateEnabled,
      source.passingScore,
      source.estimatedMinutes,
      JSON.stringify(source.learningObjectives),
      input.actorSubjectId,
    ],
  );
  const newRow = created.rows[0];
  if (newRow === undefined) throw new Error('LEARNING_COURSE_VERSION_INSERT_FAILED');

  const clonedDraft = validateCourseDraft({
    title: source.title,
    summary: source.summary,
    description: source.description,
    language: source.language,
    visibility: source.visibility,
    enrollmentMode: source.enrollmentMode,
    certificateEnabled: source.certificateEnabled,
    passingScore: source.passingScore,
    estimatedMinutes: source.estimatedMinutes,
    learningObjectives: source.learningObjectives,
    modules: source.modules.map((module) => ({
      moduleKey: module.moduleKey,
      title: module.title,
      position: module.position,
      lessons: module.lessons.map((lesson) => ({
        lessonKey: lesson.lessonKey,
        title: lesson.title,
        activityType: lesson.activityType,
        position: lesson.position,
        required: lesson.required,
        estimatedMinutes: lesson.estimatedMinutes,
        content: lesson.content,
      })),
    })),
  });
  await insertStructure(client, input.tenantId, newRow.course_version_id, clonedDraft);

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.course',
      aggregateId: input.courseId,
      eventType: 'learning.course.version.drafted',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { fromVersion: source.version, toVersion: nextVersion },
      metadata: { source: 'learning.course.authoring' },
    },
  });

  return loadLearningCourseVersion(client, {
    tenantId: input.tenantId,
    courseId: input.courseId,
    version: nextVersion,
    skipOperationalCheck: true,
  });
}

export async function publishLearningCourseVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly courseId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly version: LearningCourseVersion; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);

  const courses = await client.query<CourseRow>(
    "SELECT course_id, tenant_id, academy_id, course_key, status, current_published_version, " +
      "created_by_subject_id, created_at, updated_at FROM platform.learning_courses " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid FOR UPDATE",
    [input.tenantId, input.courseId],
  );
  const course = courses.rows[0];
  if (course === undefined) throw new Error('LEARNING_COURSE_NOT_FOUND');
  if (course.status !== 'ACTIVE') throw new Error('LEARNING_COURSE_ARCHIVED');

  const versions = await client.query<CourseVersionRow>(
    "SELECT * FROM platform.learning_course_versions " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND version = $3 FOR UPDATE",
    [input.tenantId, input.courseId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) throw new Error('LEARNING_COURSE_VERSION_NOT_FOUND');
  if (target.state === 'PUBLISHED') {
    return {
      version: await loadLearningCourseVersion(client, {
        tenantId: input.tenantId,
        courseId: input.courseId,
        version: input.version,
        skipOperationalCheck: true,
      }),
      idempotent: true,
    };
  }
  if (target.state !== 'DRAFT' && target.state !== 'IN_REVIEW') {
    throw new Error('LEARNING_COURSE_VERSION_NOT_PUBLISHABLE');
  }

  const hydrated = await loadLearningCourseVersion(client, {
    tenantId: input.tenantId,
    courseId: input.courseId,
    version: input.version,
    skipOperationalCheck: true,
  });
  assertCoursePublishable(validateCourseDraft({
    title: hydrated.title,
    summary: hydrated.summary,
    description: hydrated.description,
    language: hydrated.language,
    visibility: hydrated.visibility,
    enrollmentMode: hydrated.enrollmentMode,
    certificateEnabled: hydrated.certificateEnabled,
    passingScore: hydrated.passingScore,
    estimatedMinutes: hydrated.estimatedMinutes,
    learningObjectives: hydrated.learningObjectives,
    modules: hydrated.modules.map((module) => ({
      moduleKey: module.moduleKey,
      title: module.title,
      position: module.position,
      lessons: module.lessons.map((lesson) => ({
        lessonKey: lesson.lessonKey,
        title: lesson.title,
        activityType: lesson.activityType,
        position: lesson.position,
        required: lesson.required,
        estimatedMinutes: lesson.estimatedMinutes,
        content: lesson.content,
      })),
    })),
  }));

  const superseded = await client.query<{ readonly version: number }>(
    "UPDATE platform.learning_course_versions SET state = 'SUPERSEDED', " +
      "updated_by_subject_id = $3, updated_at = now() " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND state = 'PUBLISHED' AND version <> $4 " +
      "RETURNING version",
    [input.tenantId, input.courseId, input.actorSubjectId, input.version],
  );

  await client.query(
    "UPDATE platform.learning_course_versions SET state = 'PUBLISHED', " +
      "published_by_subject_id = $4, published_at = now(), updated_by_subject_id = $4, updated_at = now() " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid AND version = $3",
    [input.tenantId, input.courseId, input.version, input.actorSubjectId],
  );
  await client.query(
    "UPDATE platform.learning_courses SET current_published_version = $3, updated_at = now() " +
      "WHERE tenant_id = $1::uuid AND course_id = $2::uuid",
    [input.tenantId, input.courseId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.course',
      aggregateId: input.courseId,
      eventType: 'learning.course.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        courseKey: course.course_key,
        publishedVersion: input.version,
        supersededVersions: superseded.rows.map((row) => row.version),
      },
      metadata: { source: 'learning.course.publication' },
    },
  });

  return {
    version: await loadLearningCourseVersion(client, {
      tenantId: input.tenantId,
      courseId: input.courseId,
      version: input.version,
      skipOperationalCheck: true,
    }),
    idempotent: false,
  };
}

async function insertStructure(
  client: PostgresClient,
  tenantId: string,
  courseVersionId: string,
  draft: ValidatedCourseDraft,
): Promise<void> {
  for (const module of draft.modules) {
    const modules = await client.query<{ readonly course_module_id: string }>(
      "INSERT INTO platform.learning_course_modules " +
        "(tenant_id, course_version_id, module_key, title, position) " +
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING course_module_id",
      [tenantId, courseVersionId, module.moduleKey, module.title, module.position],
    );
    const moduleRow = modules.rows[0];
    if (moduleRow === undefined) throw new Error('LEARNING_COURSE_MODULE_INSERT_FAILED');

    for (const lesson of module.lessons) {
      await client.query(
        "INSERT INTO platform.learning_lessons " +
          "(tenant_id, course_version_id, course_module_id, lesson_key, title, activity_type, " +
          "position, required, estimated_minutes, content) " +
          "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::jsonb)",
        [
          tenantId,
          courseVersionId,
          moduleRow.course_module_id,
          lesson.lessonKey,
          lesson.title,
          lesson.activityType,
          lesson.position,
          lesson.required,
          lesson.estimatedMinutes,
          JSON.stringify(lesson.content),
        ],
      );
    }
  }
}
