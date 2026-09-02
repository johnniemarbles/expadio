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

test('Learning activation -> draft -> publish -> clone -> supersede is durable and replay-safe', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Learning lifecycle tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.tenant_module_entitlements
         (tenant_id, module_key, source_type, source_key, status)
       VALUES ($1::uuid, 'learning', 'PLAN', 'itest-enterprise', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await c.query('BEGIN');
    const activation = await activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'learning-activation-itest',
    });
    await c.query('COMMIT');
    assert.equal(activation.status, 'ACTIVE');
    assert.equal(activation.academy.sourceVerticalKey, 'acme-corp');

    await c.query('BEGIN');
    const created = await createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-create-itest',
      courseKey: 'privacy.fundamentals',
      draft: {
        title: 'Privacy Fundamentals',
        summary: 'Tenant privacy training',
        language: 'en-CA',
        visibility: 'TENANT',
        estimatedMinutes: 20,
        learningObjectives: ['Recognize protected personal information'],
        modules: [{
          moduleKey: 'privacy-basics',
          title: 'Privacy basics',
          position: 1,
          lessons: [{
            lessonKey: 'intro',
            title: 'Introduction',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 10,
            content: { body: 'Approved source-backed content.' },
          }],
        }],
      },
    });
    await c.query('COMMIT');
    assert.equal(created.version.version, 1);
    assert.equal(created.version.state, 'DRAFT');
    assert.equal(created.version.modules.length, 1);

    await c.query('BEGIN');
    const firstPublish = await publishLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-publish-v1-itest',
    });
    await c.query('COMMIT');
    assert.equal(firstPublish.idempotent, false);
    assert.equal(firstPublish.version.state, 'PUBLISHED');

    await c.query('BEGIN');
    const replay = await publishLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-publish-v1-replay-itest',
    });
    await c.query('COMMIT');
    assert.equal(replay.idempotent, true);

    await c.query('BEGIN');
    const v2 = await clonePublishedLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-clone-v2-itest',
    });
    await c.query('COMMIT');
    assert.equal(v2.version, 2);
    assert.equal(v2.state, 'DRAFT');

    await c.query('BEGIN');
    const editedV2 = await replaceLearningCourseDraft(c, {
      tenantId,
      courseId: created.courseId,
      version: 2,
      actorSubjectId: 'learning-admin',
      draft: {
        title: 'Privacy Fundamentals 2027',
        summary: 'Updated tenant privacy training',
        language: 'en-CA',
        visibility: 'TENANT',
        estimatedMinutes: 25,
        learningObjectives: ['Recognize protected personal information'],
        modules: [{
          moduleKey: 'privacy-basics',
          title: 'Privacy basics',
          position: 1,
          lessons: [{
            lessonKey: 'intro',
            title: 'Updated introduction',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 12,
            content: { body: 'Updated approved content.' },
          }],
        }],
      },
    });
    await c.query('COMMIT');
    assert.equal(editedV2.title, 'Privacy Fundamentals 2027');

    await c.query('BEGIN');
    const secondPublish = await publishLearningCourseVersion(c, {
      tenantId,
      courseId: created.courseId,
      version: 2,
      actorSubjectId: 'learning-admin',
      correlationId: 'course-publish-v2-itest',
    });
    await c.query('COMMIT');
    assert.equal(secondPublish.version.state, 'PUBLISHED');

    const states = await c.query(
      `SELECT version, state
         FROM platform.learning_course_versions
        WHERE tenant_id = $1::uuid AND course_id = $2::uuid
        ORDER BY version`,
      [tenantId, created.courseId],
    );
    assert.deepEqual(states.rows, [
      { version: 1, state: 'SUPERSEDED' },
      { version: 2, state: 'PUBLISHED' },
    ]);

    await c.query('BEGIN');
    await assert.rejects(
      () => replaceLearningCourseDraft(c, {
        tenantId,
        courseId: created.courseId,
        version: 1,
        actorSubjectId: 'learning-admin',
        draft: {
          title: 'Illegal edit',
          language: 'en',
          learningObjectives: ['Should fail'],
          modules: [],
        },
      }),
      /IMMUTABLE/,
    );
    await c.query('ROLLBACK');

    const eventTypes = await c.query(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type IN ('tenant.module','learning.course')
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId],
    );
    assert.deepEqual(eventTypes.rows, [
      { event_type: 'learning.course.created', count: 1 },
      { event_type: 'learning.course.version.drafted', count: 1 },
      { event_type: 'learning.course.version.published', count: 2 },
      { event_type: 'tenant.module.activated', count: 1 },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});
