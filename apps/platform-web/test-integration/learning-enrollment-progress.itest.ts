import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import {
  clonePublishedLearningCourseVersion,
  createLearningCourse,
  publishLearningCourseVersion,
  replaceLearningCourseDraft,
} from '@expadio/postgres-runtime/learning';
import {
  completeMyLearningLesson,
  createLearningEnrollment,
  createLearningLearner,
  listMyLearningEnrollments,
  loadMyLearningTranscript,
} from '@expadio/postgres-runtime/learning-enrollment';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

async function tx<T>(client: pg.PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

test('enrollment pins published version and completion survives later course publication', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const learnerSubject = 'learner-itest-' + randomUUID();
    const issuer = 'https://clerk.expadio.com';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Learning Enrollment Tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, name
       ) VALUES ($1::uuid, $2::uuid, 'Learning Org')`,
      [organizationId, tenantId],
    );
    await c.query(
      `INSERT INTO platform.memberships (
         tenant_id, organization_id, subject_id, actor_kind, issuer, status
       ) VALUES ($1::uuid, $2::uuid, $3, 'user', $4, 'ACTIVE')`,
      [tenantId, organizationId, learnerSubject, issuer],
    );
    await c.query(
      `INSERT INTO platform.tenant_module_entitlements (
         tenant_id, module_key, source_type, source_key, status
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'itest-learning', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () => activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'activate-learning-enrollment-itest',
    }));

    const created = await tx(c, () => createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-v1-create-itest',
      courseKey: 'privacy.required',
      draft: {
        title: 'Privacy Required 2026',
        language: 'en-CA',
        visibility: 'TENANT',
        learningObjectives: ['Apply privacy requirements'],
        modules: [{
          moduleKey: 'privacy',
          title: 'Privacy',
          position: 1,
          lessons: [
            {
              lessonKey: 'lesson-one',
              title: 'Privacy foundations',
              activityType: 'TEXT',
              position: 1,
              required: true,
              estimatedMinutes: 5,
              content: { body: 'Foundation.' },
            },
            {
              lessonKey: 'lesson-two',
              title: 'Privacy decisions',
              activityType: 'TEXT',
              position: 2,
              required: true,
              estimatedMinutes: 5,
              content: { body: 'Decisions.' },
            },
          ],
        }],
      },
    }));

    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-v1-publish-itest',
    }));

    const learner = await tx(c, () => createLearningLearner(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      learner: {
        subjectId: learnerSubject,
        fullName: 'Internal Learner',
        email: 'learner@example.com',
        audienceType: 'INTERNAL',
      },
    }));
    assert.equal(learner.subjectIssuer, issuer);

    const assignmentKey = 'manual:privacy:' + learner.learnerId;
    const assigned = await tx(c, () => createLearningEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'enrollment-create-itest',
      enrollment: {
        assignmentKey,
        learnerId: learner.learnerId,
        courseId: created.courseId,
        sourceType: 'MANUAL',
      },
    }));
    assert.equal(assigned.idempotent, false);
    assert.equal(assigned.enrollment.courseVersion, 1);

    const replay = await tx(c, () => createLearningEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'enrollment-replay-itest',
      enrollment: {
        assignmentKey,
        learnerId: learner.learnerId,
        courseId: created.courseId,
        sourceType: 'MANUAL',
      },
    }));
    assert.equal(replay.idempotent, true);
    assert.equal(replay.enrollment.enrollmentId, assigned.enrollment.enrollmentId);

    const v2 = await tx(c, () => clonePublishedLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-v2-clone-itest',
    }));
    await tx(c, () => replaceLearningCourseDraft(c, {
      tenantId,
      courseId: created.courseId,
      version: v2.version,
      actorSubjectId: 'learning-admin',
      draft: {
        title: 'Privacy Required 2027',
        language: 'en-CA',
        visibility: 'TENANT',
        learningObjectives: ['Apply updated privacy requirements'],
        modules: [{
          moduleKey: 'privacy',
          title: 'Privacy updated',
          position: 1,
          lessons: [{
            lessonKey: 'new-lesson',
            title: 'Updated privacy',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 7,
            content: { body: 'Updated.' },
          }],
        }],
      },
    }));
    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      version: 2,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-v2-publish-itest',
    }));

    const myLearning = await tx(c, () => listMyLearningEnrollments(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(myLearning.enrollments.length, 1);
    const pinned = myLearning.enrollments[0];
    assert.ok(pinned);
    assert.equal(pinned.courseVersion, 1);
    assert.equal(pinned.courseTitle, 'Privacy Required 2026');
    assert.equal(pinned.lessons.length, 2);

    const firstLessonId = pinned.lessons[0]?.lessonId;
    const secondLessonId = pinned.lessons[1]?.lessonId;
    assert.ok(firstLessonId);
    assert.ok(secondLessonId);

    const first = await tx(c, () => completeMyLearningLesson(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      enrollmentId: pinned.enrollmentId,
      lessonId: firstLessonId,
      correlationId: 'lesson-one-complete-itest',
    }));
    assert.equal(first.enrollmentStatus, 'IN_PROGRESS');
    assert.equal(first.completionPercent, 50);
    assert.equal(first.courseCompleted, false);

    const firstReplay = await tx(c, () => completeMyLearningLesson(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      enrollmentId: pinned.enrollmentId,
      lessonId: firstLessonId,
      correlationId: 'lesson-one-replay-itest',
    }));
    assert.equal(firstReplay.idempotent, true);
    assert.equal(firstReplay.completionPercent, 50);

    await assert.rejects(
      () => tx(c, () => completeMyLearningLesson(c, {
        tenantId,
        subjectId: 'different-subject',
        subjectIssuer: issuer,
        enrollmentId: pinned.enrollmentId,
        lessonId: secondLessonId,
        correlationId: 'cross-subject-denied-itest',
      })),
      /LEARNING_ENROLLMENT_NOT_FOUND/,
    );

    const completed = await tx(c, () => completeMyLearningLesson(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      enrollmentId: pinned.enrollmentId,
      lessonId: secondLessonId,
      correlationId: 'lesson-two-complete-itest',
    }));
    assert.equal(completed.enrollmentStatus, 'COMPLETED');
    assert.equal(completed.completionPercent, 100);
    assert.equal(completed.courseCompleted, true);

    const transcript = await tx(c, () => loadMyLearningTranscript(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(transcript.length, 1);
    assert.equal(transcript[0]?.courseVersion, 1);
    assert.equal(transcript[0]?.courseTitle, 'Privacy Required 2026');

    const persisted = await c.query(
      `SELECT e.status, e.completion_percent, v.version, v.title
         FROM platform.learning_enrollments e
         JOIN platform.learning_course_versions v
           ON v.course_version_id = e.course_version_id
          AND v.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1::uuid
          AND e.enrollment_id = $2::uuid`,
      [tenantId, pinned.enrollmentId],
    );
    assert.equal(persisted.rows[0]?.status, 'COMPLETED');
    assert.equal(Number(persisted.rows[0]?.completion_percent), 100);
    assert.equal(persisted.rows[0]?.version, 1);
    assert.equal(persisted.rows[0]?.title, 'Privacy Required 2026');

    const eventCounts = await c.query(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_id = $2
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId, pinned.enrollmentId],
    );
    assert.deepEqual(eventCounts.rows, [
      { event_type: 'learning.course.completed', count: 1 },
      { event_type: 'learning.course.started', count: 1 },
      { event_type: 'learning.enrollment.created', count: 1 },
      { event_type: 'learning.lesson.completed', count: 2 },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});
