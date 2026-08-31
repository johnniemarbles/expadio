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
  createLearningEnrollment,
  createLearningLearner,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  createLearningAssessment,
  createLearningQuestion,
  createLearningQuestionBank,
  listMyAvailableAssessments,
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

test('assessment pins course/question versions and grades without leaking answer keys', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const learnerSubject = 'assessment-learner-' + randomUUID();
    const issuer = 'https://clerk.expadio.com';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Assessment Tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, name
       ) VALUES ($1::uuid, $2::uuid, 'Assessment Org')`,
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
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'itest-assessment', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () => activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assessment-activate-itest',
    }));

    const course = await tx(c, () => createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assessment-course-create-itest',
      courseKey: 'privacy.assessment.course',
      draft: {
        title: 'Privacy Assessment Course',
        language: 'en-CA',
        visibility: 'TENANT',
        learningObjectives: ['Apply privacy controls'],
        modules: [{
          moduleKey: 'privacy',
          title: 'Privacy',
          position: 1,
          lessons: [{
            lessonKey: 'foundation',
            title: 'Foundation',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 5,
            content: { body: 'Privacy.' },
          }],
        }],
      },
    }));
    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: course.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'assessment-course-publish-itest',
    }));

    const courseVersion = await c.query<{ course_version_id: string }>(
      `SELECT course_version_id
         FROM platform.learning_course_versions
        WHERE tenant_id = $1::uuid
          AND course_id = $2::uuid
          AND version = 1`,
      [tenantId, course.courseId],
    );
    const courseVersionId = courseVersion.rows[0]?.course_version_id;
    assert.ok(courseVersionId);

    const learner = await tx(c, () => createLearningLearner(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      learner: {
        subjectId: learnerSubject,
        fullName: 'Assessment Learner',
        email: 'assessment@example.com',
        audienceType: 'INTERNAL',
      },
    }));

    const enrolled = await tx(c, () => createLearningEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'assessment-enroll-itest',
      enrollment: {
        assignmentKey: 'manual:assessment:' + learner.learnerId,
        learnerId: learner.learnerId,
        courseId: course.courseId,
        sourceType: 'MANUAL',
      },
    }));
    assert.equal(enrolled.enrollment.courseVersionId, courseVersionId);

    const bank = await tx(c, () => createLearningQuestionBank(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      bankKey: 'privacy.core',
      name: 'Privacy Core',
    }));

    const question = await tx(c, () => createLearningQuestion(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      questionBankId: bank.questionBankId,
      questionKey: 'minimum-necessary',
      draft: {
        prompt: 'Which principle limits data use to what is needed?',
        type: 'SINGLE_CHOICE',
        options: [
          { key: 'minimum', label: 'Minimum necessary' },
          { key: 'maximum', label: 'Maximum collection' },
        ],
        answerKey: { answer: 'minimum' },
        explanation: 'Use only the minimum data required.',
      },
    }));
    await tx(c, () => publishLearningQuestionVersion(c, {
      tenantId,
      questionId: question.questionId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'question-publish-itest',
    }));

    const assessment = await tx(c, () => createLearningAssessment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      assessmentKey: 'privacy.final',
      draft: {
        title: 'Privacy Final',
        instructions: 'Select the best answer.',
        type: 'EXAM',
        passPercent: 100,
        maxAttempts: 2,
        courseVersionId,
        items: [{
          questionVersionId: question.questionVersionId,
          position: 1,
          points: 5,
        }],
      },
    }));
    await tx(c, () => publishLearningAssessmentVersion(c, {
      tenantId,
      assessmentId: assessment.assessmentId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'assessment-publish-itest',
    }));

    const available = await tx(c, () => listMyAvailableAssessments(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(available.length, 1);
    assert.equal(available[0]?.assessmentId, assessment.assessmentId);
    assert.equal(available[0]?.enrollmentId, enrolled.enrollment.enrollmentId);
    assert.equal(available[0]?.attemptsUsed, 0);

    const first = await tx(c, () => startMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      assessmentId: assessment.assessmentId,
      enrollmentId: enrolled.enrollment.enrollmentId,
      attemptKey: 'assessment:first:' + learner.learnerId,
      correlationId: 'assessment-attempt-first-itest',
    }));
    assert.equal(first.idempotent, false);
    assert.equal(first.assessmentVersion, 1);
    assert.equal(first.questions.length, 1);
    assert.deepEqual(first.questions[0], {
      questionVersionId: question.questionVersionId,
      position: 1,
      points: 5,
      prompt: 'Which principle limits data use to what is needed?',
      type: 'SINGLE_CHOICE',
      options: [
        { key: 'minimum', label: 'Minimum necessary' },
        { key: 'maximum', label: 'Maximum collection' },
      ],
    });
    assert.equal('answerKey' in (first.questions[0] as Record<string, unknown>), false);
    assert.equal('explanation' in (first.questions[0] as Record<string, unknown>), false);

    const firstReplay = await tx(c, () => startMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      assessmentId: assessment.assessmentId,
      enrollmentId: enrolled.enrollment.enrollmentId,
      attemptKey: 'assessment:first:' + learner.learnerId,
      correlationId: 'assessment-attempt-first-replay-itest',
    }));
    assert.equal(firstReplay.idempotent, true);
    assert.equal(firstReplay.attemptId, first.attemptId);

    await assert.rejects(
      () => tx(c, () => submitMyAssessmentAttempt(c, {
        tenantId,
        subjectId: 'different-subject',
        subjectIssuer: issuer,
        attemptId: first.attemptId,
        responses: {
          responses: [{
            questionVersionId: question.questionVersionId,
            response: 'minimum',
          }],
        },
        correlationId: 'assessment-cross-subject-itest',
      })),
      /LEARNING_ASSESSMENT_ATTEMPT_NOT_FOUND/,
    );

    const failed = await tx(c, () => submitMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      attemptId: first.attemptId,
      responses: {
        responses: [{
          questionVersionId: question.questionVersionId,
          response: 'maximum',
        }],
      },
      correlationId: 'assessment-fail-itest',
    }));
    assert.equal(failed.scorePercent, 0);
    assert.equal(failed.passed, false);

    const failedReplay = await tx(c, () => submitMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      attemptId: first.attemptId,
      responses: {
        responses: [{
          questionVersionId: question.questionVersionId,
          response: 'minimum',
        }],
      },
      correlationId: 'assessment-fail-replay-itest',
    }));
    assert.equal(failedReplay.idempotent, true);
    assert.equal(failedReplay.scorePercent, 0);
    assert.equal(failedReplay.passed, false);

    const second = await tx(c, () => startMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      assessmentId: assessment.assessmentId,
      enrollmentId: enrolled.enrollment.enrollmentId,
      attemptKey: 'assessment:second:' + learner.learnerId,
      correlationId: 'assessment-attempt-second-itest',
    }));
    assert.equal(second.attemptNumber, 2);

    const passed = await tx(c, () => submitMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      attemptId: second.attemptId,
      responses: {
        responses: [{
          questionVersionId: question.questionVersionId,
          response: 'minimum',
        }],
      },
      correlationId: 'assessment-pass-itest',
    }));
    assert.equal(passed.scorePercent, 100);
    assert.equal(passed.passed, true);

    await assert.rejects(
      () => tx(c, () => startMyAssessmentAttempt(c, {
        tenantId,
        subjectId: learnerSubject,
        subjectIssuer: issuer,
        assessmentId: assessment.assessmentId,
        enrollmentId: enrolled.enrollment.enrollmentId,
        attemptKey: 'assessment:third:' + learner.learnerId,
        correlationId: 'assessment-attempt-limit-itest',
      })),
      /LEARNING_ASSESSMENT_ATTEMPT_LIMIT_REACHED/,
    );

    const after = await tx(c, () => listMyAvailableAssessments(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(after[0]?.attemptsUsed, 2);
    assert.equal(after[0]?.bestScorePercent, 100);
    assert.equal(after[0]?.passed, true);

    const responses = await c.query(
      `SELECT attempt_id, question_version_id, correct, awarded_points, max_points
         FROM platform.learning_assessment_responses
        WHERE tenant_id = $1::uuid
        ORDER BY created_at`,
      [tenantId],
    );
    assert.equal(responses.rows.length, 2);
    assert.equal(responses.rows[0]?.correct, false);
    assert.equal(Number(responses.rows[0]?.awarded_points), 0);
    assert.equal(responses.rows[1]?.correct, true);
    assert.equal(Number(responses.rows[1]?.awarded_points), 5);

    const events = await c.query(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type = 'learning.assessment_attempt'
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId],
    );
    assert.deepEqual(events.rows, [
      { event_type: 'learning.assessment.failed', count: 1 },
      { event_type: 'learning.assessment.passed', count: 1 },
      { event_type: 'learning.assessment.started', count: 2 },
    ]);

    const persistedVersion = await c.query(
      `SELECT attempt.assessment_version_id, attempt.course_version_id,
              item.question_version_id
         FROM platform.learning_assessment_attempts attempt
         JOIN platform.learning_assessment_items item
           ON item.assessment_version_id = attempt.assessment_version_id
          AND item.tenant_id = attempt.tenant_id
        WHERE attempt.tenant_id = $1::uuid
        ORDER BY attempt.attempt_number
        LIMIT 1`,
      [tenantId],
    );
    assert.equal(persistedVersion.rows[0]?.assessment_version_id, assessment.assessmentVersionId);
    assert.equal(persistedVersion.rows[0]?.course_version_id, courseVersionId);
    assert.equal(persistedVersion.rows[0]?.question_version_id, question.questionVersionId);
  } finally {
    c.release();
    await p.end();
  }
});
