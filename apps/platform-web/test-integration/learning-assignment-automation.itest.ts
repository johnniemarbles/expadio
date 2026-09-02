import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import {
  createLearningCourse,
  publishLearningCourseVersion,
} from '@expadio/postgres-runtime/learning';
import {
  createLearningLearner,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  createLearningProgram,
  publishLearningProgramVersion,
} from '@expadio/postgres-runtime/learning-program-certification';
import {
  createLearningAssignmentRule,
  evaluateLearningAssignmentRulesForLearner,
  listLearningAssignmentRuleExecutions,
  publishLearningAssignmentRuleVersion,
} from '@expadio/postgres-runtime/learning-assignment-automation';
import {
  processOneDomainEventActionWorkItem,
  type DomainEventActionWorkerResult,
} from '../lib/domain-event-action-worker';

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

async function drain(
  client: pg.PoolClient,
  tenantId: string,
  now: Date,
): Promise<readonly DomainEventActionWorkerResult[]> {
  const results: DomainEventActionWorkerResult[] = [];
  for (let index = 0; index < 30; index += 1) {
    const item = await processOneDomainEventActionWorkItem(client, {
      tenantId,
      now: () => now,
    });
    results.push(item);
    if (item.status === 'IDLE') break;
  }
  if (results.at(-1)?.status !== 'IDLE') {
    throw new Error('learning assignment automation worker did not drain');
  }
  return results;
}

test('learner-created event applies published assignment rules exactly once', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Assignment Automation Tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.tenant_module_entitlements (
         tenant_id, module_key, source_type, source_key, status
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'itest-assignment-automation', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () => activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assignment-activate-itest',
    }));

    const course = await tx(c, () => createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assignment-course-create-itest',
      courseKey: 'assignment.onboarding.course',
      draft: {
        title: 'Ontario Onboarding',
        language: 'en-CA',
        visibility: 'TENANT',
        learningObjectives: ['Complete Ontario onboarding'],
        modules: [{
          moduleKey: 'onboarding',
          title: 'Onboarding',
          position: 1,
          lessons: [{
            lessonKey: 'welcome',
            title: 'Welcome',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 5,
            content: { body: 'Welcome.' },
          }],
        }],
      },
    }));
    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: course.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'assignment-course-publish-itest',
    }));

    const courseVersionId = (await c.query<{ course_version_id: string }>(
      `SELECT course_version_id
         FROM platform.learning_course_versions
        WHERE tenant_id = $1::uuid
          AND course_id = $2::uuid
          AND version = 1`,
      [tenantId, course.courseId],
    )).rows[0]?.course_version_id;
    assert.ok(courseVersionId);

    const program = await tx(c, () => createLearningProgram(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      programKey: 'assignment.onboarding.program',
      draft: {
        title: 'Ontario Onboarding Program',
        items: [{
          type: 'COURSE',
          courseVersionId,
          position: 1,
          required: true,
        }],
      },
    }));
    await tx(c, () => publishLearningProgramVersion(c, {
      tenantId,
      programId: program.programId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'assignment-program-publish-itest',
    }));

    async function rule(
      ruleKey: string,
      draft: Record<string, unknown>,
    ) {
      const created = await tx(c, () => createLearningAssignmentRule(c, {
        tenantId,
        actorSubjectId: 'learning-admin',
        ruleKey,
        draft,
      }));
      await tx(c, () => publishLearningAssignmentRuleVersion(c, {
        tenantId,
        assignmentRuleId: created.assignmentRuleId,
        version: 1,
        actorSubjectId: 'learning-admin',
        correlationId: 'assignment-rule-publish:' + ruleKey,
      }));
      return created;
    }

    const firstCourseRule = await rule('a.internal.ontario.course', {
      name: 'Assign Ontario course',
      targetType: 'COURSE',
      courseId: course.courseId,
      dueDays: 30,
      conditions: {
        audienceTypes: ['INTERNAL'],
        metadataEquals: { region: 'ON' },
      },
    });
    const duplicateCourseRule = await rule('b.internal.ontario.course', {
      name: 'Confirm Ontario course',
      targetType: 'COURSE',
      courseId: course.courseId,
      conditions: {
        audienceTypes: ['INTERNAL'],
        metadataEquals: { region: 'ON' },
      },
    });
    const programRule = await rule('c.internal.ontario.program', {
      name: 'Assign Ontario program',
      targetType: 'PROGRAM',
      programId: program.programId,
      conditions: {
        audienceTypes: ['INTERNAL'],
        metadataEquals: { region: 'ON' },
      },
    });
    await rule('d.partner.course', {
      name: 'Partner-only course',
      targetType: 'COURSE',
      courseId: course.courseId,
      conditions: {
        audienceTypes: ['PARTNER'],
      },
    });

    const learner = await tx(c, () => createLearningLearner(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assignment-learner-create-itest',
      learner: {
        externalRef: 'assignment-learner-' + randomUUID(),
        fullName: 'Ontario Internal Learner',
        email: 'automation@example.com',
        audienceType: 'INTERNAL',
        metadata: { region: 'ON', team: 'operations' },
      },
    }));

    const learnerEvent = (await c.query<{ event_id: string }>(
      `SELECT event_id
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type = 'learning.learner'
          AND aggregate_id = $2
          AND event_type = 'learning.learner.created'
        LIMIT 1`,
      [tenantId, learner.learnerId],
    )).rows[0]?.event_id;
    assert.ok(learnerEvent);

    assert.equal((await c.query(
      `SELECT count(*)::int AS count
         FROM platform.learning_enrollments
        WHERE tenant_id = $1::uuid AND learner_id = $2::uuid`,
      [tenantId, learner.learnerId],
    )).rows[0]?.count, 0);

    const workerNow = new Date(Date.now() + 60_000);
    const workerResults = await drain(c, tenantId, workerNow);
    const learnerWork = workerResults.find(
      (item) =>
        item.status === 'PUBLISHED'
        && item.claim.event.eventType === 'learning.learner.created',
    );
    assert.ok(learnerWork);
    if (learnerWork?.status !== 'PUBLISHED') {
      throw new Error('expected published learner-created work item');
    }

    assert.deepEqual(
      [...(learnerWork.learningAssignments ?? [])]
        .map((item) => [item.ruleKey, item.outcome])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        ['a.internal.ontario.course', 'ASSIGNED'],
        ['b.internal.ontario.course', 'SATISFIED'],
        ['c.internal.ontario.program', 'ASSIGNED'],
        ['d.partner.course', 'NOT_MATCHED'],
      ],
    );

    const courseEnrollments = await c.query<{
      enrollment_id: string;
      assignment_key: string;
      source_type: string;
      source_ref: string | null;
      course_version_id: string;
      due_at: Date | null;
    }>(
      `SELECT enrollment_id, assignment_key, source_type, source_ref,
              course_version_id, due_at
         FROM platform.learning_enrollments
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND course_id = $3::uuid`,
      [tenantId, learner.learnerId, course.courseId],
    );
    assert.equal(courseEnrollments.rows.length, 1);
    const courseEnrollment = courseEnrollments.rows[0];
    assert.ok(courseEnrollment);
    assert.equal(courseEnrollment.source_type, 'RULE');
    assert.equal(courseEnrollment.source_ref, firstCourseRule.assignmentRuleVersionId);
    assert.equal(courseEnrollment.course_version_id, courseVersionId);
    assert.ok(courseEnrollment.assignment_key.startsWith('lar:'));
    assert.equal(
      courseEnrollment.due_at?.toISOString(),
      new Date(workerNow.getTime() + 30 * 86_400_000).toISOString(),
    );

    const programEnrollments = await c.query<{
      program_enrollment_id: string;
      assignment_key: string;
      source_type: string;
      program_version_id: string;
    }>(
      `SELECT program_enrollment_id, assignment_key, source_type,
              program_version_id
         FROM platform.learning_program_enrollments
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND program_id = $3::uuid`,
      [tenantId, learner.learnerId, program.programId],
    );
    assert.equal(programEnrollments.rows.length, 1);
    assert.equal(programEnrollments.rows[0]?.source_type, 'RULE');
    assert.ok(programEnrollments.rows[0]?.assignment_key.startsWith('lar:'));
    assert.equal(
      programEnrollments.rows[0]?.program_version_id,
      program.programVersionId,
    );

    const executions = await tx(c, () => listLearningAssignmentRuleExecutions(c, {
      tenantId,
      learnerId: learner.learnerId,
    }));
    assert.equal(executions.length, 4);
    assert.equal(
      executions.every((item) => item.triggerEventId === learnerEvent),
      true,
    );
    assert.deepEqual(
      executions.map((item) => item.outcome).sort(),
      ['ASSIGNED', 'ASSIGNED', 'NOT_MATCHED', 'SATISFIED'],
    );

    const firstExecution = executions.find(
      (item) => item.assignmentRuleVersionId === firstCourseRule.assignmentRuleVersionId,
    );
    const duplicateExecution = executions.find(
      (item) => item.assignmentRuleVersionId === duplicateCourseRule.assignmentRuleVersionId,
    );
    assert.equal(firstExecution?.enrollmentId, courseEnrollment.enrollment_id);
    assert.equal(duplicateExecution?.enrollmentId, courseEnrollment.enrollment_id);

    const replay = await tx(c, () => evaluateLearningAssignmentRulesForLearner(c, {
      tenantId,
      learnerId: learner.learnerId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assignment-manual-replay-itest',
    }));
    assert.equal(replay.length, 4);
    assert.equal(replay.every((item) => item.idempotent), true);

    assert.equal((await c.query(
      `SELECT count(*)::int AS count
         FROM platform.learning_enrollments
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND course_id = $3::uuid`,
      [tenantId, learner.learnerId, course.courseId],
    )).rows[0]?.count, 1);
    assert.equal((await c.query(
      `SELECT count(*)::int AS count
         FROM platform.learning_program_enrollments
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND program_id = $3::uuid`,
      [tenantId, learner.learnerId, program.programId],
    )).rows[0]?.count, 1);

    const learnerOutbox = (await c.query(
      `SELECT status, attempts
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid
          AND event_id = $2::uuid`,
      [tenantId, learnerEvent],
    )).rows[0];
    assert.deepEqual(learnerOutbox, {
      status: 'PUBLISHED',
      attempts: 1,
    });

    const assignmentRows = await c.query(
      `SELECT count(*)::int AS count
         FROM platform.learning_assignment_rule_executions
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid`,
      [tenantId, learner.learnerId],
    );
    assert.equal(assignmentRows.rows[0]?.count, 4);

    const emittedEnrollments = await c.query<{
      event_type: string;
      count: number;
    }>(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND event_type IN (
            'learning.learner.created',
            'learning.enrollment.created',
            'learning.program.enrollment.created'
          )
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId],
    );
    assert.deepEqual(emittedEnrollments.rows, [
      { event_type: 'learning.enrollment.created', count: 1 },
      { event_type: 'learning.learner.created', count: 1 },
      { event_type: 'learning.program.enrollment.created', count: 1 },
    ]);

    assert.equal(
      executions.find(
        (item) => item.assignmentRuleVersionId === programRule.assignmentRuleVersionId,
      )?.programEnrollmentId,
      programEnrollments.rows[0]?.program_enrollment_id,
    );
  } finally {
    c.release();
    await p.end();
  }
});
