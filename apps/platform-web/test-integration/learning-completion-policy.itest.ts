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
  completeMyLearningLesson,
  createLearningEnrollment,
  createLearningLearner,
  loadMyLearningTranscript,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  createLearningAssessment,
  createLearningQuestion,
  createLearningQuestionBank,
  publishLearningAssessmentVersion,
  publishLearningQuestionVersion,
  startMyAssessmentAttempt,
  submitMyAssessmentAttempt,
} from '@expadio/postgres-runtime/learning-assessment';

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

test('required assessment gates course completion and assessment pass releases it', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const learnerSubject = 'completion-policy-' + randomUUID();
    const issuer = 'https://clerk.expadio.com';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Completion Policy Tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.organizations (organization_id, tenant_id, name)
       VALUES ($1::uuid, $2::uuid, 'Completion Policy Org')`,
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
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'completion-policy-itest', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () => activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'completion-policy-activate',
    }));

    const course = await tx(c, () => createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'completion-policy-course',
      courseKey: 'compliance.required',
      draft: {
        title: 'Required compliance',
        language: 'en',
        visibility: 'TENANT',
        learningObjectives: ['Demonstrate compliance'],
        modules: [{
          moduleKey: 'core',
          title: 'Core',
          position: 1,
          lessons: [{
            lessonKey: 'required-content',
            title: 'Required content',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 5,
            content: { text: 'Read this.' },
          }],
        }],
      },
    }));

    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: course.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'completion-policy-publish-course',
    }));

    const bank = await tx(c, () => createLearningQuestionBank(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      bankKey: 'compliance',
      name: 'Compliance',
    }));
    const question = await tx(c, () => createLearningQuestion(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      questionBankId: bank.questionBankId,
      questionKey: 'required-answer',
      draft: {
        prompt: 'Select the correct answer.',
        type: 'SINGLE_CHOICE',
        options: [
          { key: 'a', label: 'Incorrect' },
          { key: 'b', label: 'Correct' },
        ],
        answerKey: { answer: 'b' },
        explanation: 'B is correct.',
      },
    }));
    await tx(c, () => publishLearningQuestionVersion(c, {
      tenantId,
      questionId: question.questionId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'completion-policy-publish-question',
    }));

    const assessment = await tx(c, () => createLearningAssessment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      assessmentKey: 'compliance.exam',
      draft: {
        title: 'Compliance exam',
        type: 'EXAM',
        passPercent: 100,
        maxAttempts: 2,
        courseVersionId: course.version.courseVersionId,
        completionRequirement: 'REQUIRED',
        items: [{
          questionVersionId: question.questionVersionId,
          position: 1,
          points: 1,
        }],
      },
    }));
    await tx(c, () => publishLearningAssessmentVersion(c, {
      tenantId,
      assessmentId: assessment.assessmentId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'completion-policy-publish-assessment',
    }));

    const learner = await tx(c, () => createLearningLearner(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      learner: {
        subjectId: learnerSubject,
        fullName: 'Completion Learner',
        audienceType: 'INTERNAL',
      },
    }));
    const assigned = await tx(c, () => createLearningEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'completion-policy-enroll',
      enrollment: {
        assignmentKey: 'completion:' + learner.learnerId,
        learnerId: learner.learnerId,
        courseId: course.courseId,
        sourceType: 'MANUAL',
      },
    }));

    const lessonId = course.version.modules[0]?.lessons[0]?.lessonId;
    assert.ok(lessonId);

    const lesson = await tx(c, () => completeMyLearningLesson(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      enrollmentId: assigned.enrollment.enrollmentId,
      lessonId,
      correlationId: 'completion-policy-lesson',
    }));
    assert.equal(lesson.courseCompleted, false);
    assert.equal(lesson.enrollmentStatus, 'IN_PROGRESS');
    assert.equal(lesson.completionPercent, 50);

    const attempt = await tx(c, () => startMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      assessmentId: assessment.assessmentId,
      enrollmentId: assigned.enrollment.enrollmentId,
      attemptKey: 'completion-policy-attempt-' + randomUUID(),
      correlationId: 'completion-policy-start-assessment',
    }));
    const questionId = attempt.questions[0]?.questionVersionId;
    assert.ok(questionId);

    const grade = await tx(c, () => submitMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      attemptId: attempt.attemptId,
      responses: {
        responses: [{ questionVersionId: questionId, response: 'b' }],
      },
      correlationId: 'completion-policy-submit-assessment',
    }));
    assert.equal(grade.passed, true);
    assert.equal(grade.scorePercent, 100);

    const enrollmentState = await c.query<{
      status: string;
      completion_percent: string | number;
    }>(
      `SELECT status, completion_percent
         FROM platform.learning_enrollments
        WHERE tenant_id = $1::uuid AND enrollment_id = $2::uuid`,
      [tenantId, assigned.enrollment.enrollmentId],
    );
    assert.equal(enrollmentState.rows[0]?.status, 'COMPLETED');
    assert.equal(Number(enrollmentState.rows[0]?.completion_percent), 100);

    const transcript = await tx(c, () => loadMyLearningTranscript(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(transcript.length, 1);
    assert.equal(transcript[0]?.courseId, course.courseId);

    const events = await c.query<{ count: string | number }>(
      `SELECT count(*) AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_id = $2::uuid
          AND event_type = 'learning.course.completed'`,
      [tenantId, assigned.enrollment.enrollmentId],
    );
    assert.equal(Number(events.rows[0]?.count), 1);
  } finally {
    c.release();
    await p.end();
  }
});
