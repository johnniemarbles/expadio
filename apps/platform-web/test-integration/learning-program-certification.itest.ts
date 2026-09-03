import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import {
  completeMyLearningLesson,
  createLearningEnrollment,
  createLearningLearner,
  listMyLearningEnrollments,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  createLearningCourse,
  publishLearningCourseVersion,
} from '@expadio/postgres-runtime/learning';
import {
  createLearningAssessment,
  createLearningQuestion,
  createLearningQuestionBank,
  publishLearningAssessmentVersion,
  publishLearningQuestionVersion,
  startMyAssessmentAttempt,
  submitMyAssessmentAttempt,
} from '@expadio/postgres-runtime/learning-assessment';
import {
  createLearningCertification,
  createLearningProgram,
  createLearningProgramEnrollment,
  listMyLearningCredentials,
  publishLearningCertificationVersion,
  publishLearningProgramVersion,
  reconcileLearningCredentialStatuses,
  reconcileMyLearningProgramEnrollment,
  revokeLearningCredential,
} from '@expadio/postgres-runtime/learning-program-certification';

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

test('program completion issues one credential and governs lifecycle transitions', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const learnerSubject = 'program-learner-' + randomUUID();
    const issuer = 'https://clerk.expadio.com';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Program Certification Tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, name
       ) VALUES ($1::uuid, $2::uuid, 'Program Certification Org')`,
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
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'itest-program-cert', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () => activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-cert-activate-itest',
    }));

    const course = await tx(c, () => createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-course-create-itest',
      courseKey: 'program.privacy.course',
      draft: {
        title: 'Program Privacy Course',
        language: 'en-CA',
        visibility: 'TENANT',
        learningObjectives: ['Apply privacy controls'],
        modules: [{
          moduleKey: 'privacy',
          title: 'Privacy',
          position: 1,
          lessons: [{
            lessonKey: 'privacy-foundation',
            title: 'Privacy Foundation',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 5,
            content: { body: 'Privacy foundation.' },
          }],
        }],
      },
    }));
    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: course.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-course-publish-itest',
    }));

    const courseVersionResult = await c.query<{ course_version_id: string }>(
      `SELECT course_version_id
         FROM platform.learning_course_versions
        WHERE tenant_id = $1::uuid
          AND course_id = $2::uuid
          AND version = 1`,
      [tenantId, course.courseId],
    );
    const courseVersionId = courseVersionResult.rows[0]?.course_version_id;
    assert.ok(courseVersionId);

    const learner = await tx(c, () => createLearningLearner(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      learner: {
        subjectId: learnerSubject,
        fullName: 'Program Learner',
        email: 'program@example.com',
        audienceType: 'INTERNAL',
      },
    }));

    const courseEnrollment = await tx(c, () => createLearningEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-course-enroll-itest',
      enrollment: {
        assignmentKey: 'manual:program-course:' + learner.learnerId,
        learnerId: learner.learnerId,
        courseId: course.courseId,
        sourceType: 'MANUAL',
      },
    }));

    const bank = await tx(c, () => createLearningQuestionBank(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      bankKey: 'program.privacy.bank',
      name: 'Program Privacy Bank',
    }));
    const question = await tx(c, () => createLearningQuestion(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      questionBankId: bank.questionBankId,
      questionKey: 'privacy-principle',
      draft: {
        prompt: 'Which principle limits data use?',
        type: 'SINGLE_CHOICE',
        options: [
          { key: 'minimum', label: 'Minimum necessary' },
          { key: 'maximum', label: 'Maximum collection' },
        ],
        answerKey: { answer: 'minimum' },
        explanation: 'Use only the minimum required data.',
      },
    }));
    await tx(c, () => publishLearningQuestionVersion(c, {
      tenantId,
      questionId: question.questionId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-question-publish-itest',
    }));

    const assessment = await tx(c, () => createLearningAssessment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      assessmentKey: 'program.privacy.exam',
      draft: {
        title: 'Program Privacy Exam',
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
      correlationId: 'program-assessment-publish-itest',
    }));

    const program = await tx(c, () => createLearningProgram(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      programKey: 'program.privacy.onboarding',
      draft: {
        title: 'Privacy Onboarding Program',
        description: 'Course plus final assessment.',
        items: [
          {
            type: 'COURSE',
            courseVersionId,
            position: 1,
            required: true,
          },
          {
            type: 'ASSESSMENT',
            assessmentVersionId: assessment.assessmentVersionId,
            position: 2,
            required: true,
          },
        ],
      },
    }));
    await tx(c, () => publishLearningProgramVersion(c, {
      tenantId,
      programId: program.programId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-publish-itest',
    }));

    const certification = await tx(c, () => createLearningCertification(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      certificationKey: 'privacy.certified',
      draft: {
        title: 'Privacy Certified',
        description: 'Credential for completed privacy onboarding.',
        programVersionId: program.programVersionId,
        validityDays: 10,
        renewalWindowDays: 3,
      },
    }));
    await tx(c, () => publishLearningCertificationVersion(c, {
      tenantId,
      certificationId: certification.certificationId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'certification-publish-itest',
    }));

    const assigned = await tx(c, () => createLearningProgramEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-enroll-itest',
      learnerId: learner.learnerId,
      programId: program.programId,
      assignmentKey: 'manual:program:' + learner.learnerId,
      sourceType: 'MANUAL',
    }));
    assert.equal(assigned.idempotent, false);
    assert.equal(assigned.enrollment.programVersionId, program.programVersionId);

    const assignmentReplay = await tx(c, () => createLearningProgramEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'program-enroll-replay-itest',
      learnerId: learner.learnerId,
      programId: program.programId,
      assignmentKey: 'manual:program:' + learner.learnerId,
      sourceType: 'MANUAL',
    }));
    assert.equal(assignmentReplay.idempotent, true);
    assert.equal(
      assignmentReplay.enrollment.programEnrollmentId,
      assigned.enrollment.programEnrollmentId,
    );

    const before = await tx(c, () => reconcileMyLearningProgramEnrollment(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      programEnrollmentId: assigned.enrollment.programEnrollmentId,
      correlationId: 'program-reconcile-before-itest',
    }));
    assert.equal(before.enrollment.status, 'ASSIGNED');
    assert.equal(before.enrollment.completionPercent, 0);
    assert.equal(before.issuedCredentials.length, 0);

    const myLearning = await tx(c, () => listMyLearningEnrollments(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    const pinnedCourse = myLearning.enrollments.find(
      (item) => item.enrollmentId === courseEnrollment.enrollment.enrollmentId,
    );
    assert.ok(pinnedCourse);
    const lessonId = pinnedCourse.lessons[0]?.lessonId;
    assert.ok(lessonId);

    await tx(c, () => completeMyLearningLesson(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      enrollmentId: pinnedCourse.enrollmentId,
      lessonId,
      correlationId: 'program-course-complete-itest',
    }));

    const halfway = await tx(c, () => reconcileMyLearningProgramEnrollment(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      programEnrollmentId: assigned.enrollment.programEnrollmentId,
      correlationId: 'program-reconcile-halfway-itest',
    }));
    assert.equal(halfway.enrollment.status, 'IN_PROGRESS');
    assert.equal(halfway.enrollment.completionPercent, 50);
    assert.equal(halfway.requirements.filter((item) => item.completed).length, 1);
    assert.equal(halfway.issuedCredentials.length, 0);

    const attempt = await tx(c, () => startMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      assessmentId: assessment.assessmentId,
      enrollmentId: courseEnrollment.enrollment.enrollmentId,
      attemptKey: 'program-assessment:' + learner.learnerId,
      correlationId: 'program-assessment-start-itest',
    }));

    const passed = await tx(c, () => submitMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      attemptId: attempt.attemptId,
      responses: {
        responses: [{
          questionVersionId: question.questionVersionId,
          response: 'minimum',
        }],
      },
      correlationId: 'program-assessment-pass-itest',
    }));
    assert.equal(passed.passed, true);

    await assert.rejects(
      () => tx(c, () => reconcileMyLearningProgramEnrollment(c, {
        tenantId,
        subjectId: 'different-subject',
        subjectIssuer: issuer,
        programEnrollmentId: assigned.enrollment.programEnrollmentId,
        correlationId: 'program-cross-subject-itest',
      })),
      /LEARNING_LEARNER_NOT_FOUND/,
    );

    const completed = await tx(c, () => reconcileMyLearningProgramEnrollment(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      programEnrollmentId: assigned.enrollment.programEnrollmentId,
      correlationId: 'program-reconcile-complete-itest',
    }));
    assert.equal(completed.enrollment.status, 'COMPLETED');
    assert.equal(completed.enrollment.completionPercent, 100);
    // Assessment pass now reconciles affected programs immediately.
    // A later explicit reconcile is an idempotent read/reconciliation pass.
    assert.equal(completed.newlyCompleted, false);
    assert.equal(completed.issuedCredentials.length, 1);

    const credential = completed.issuedCredentials[0];
    assert.ok(credential);
    assert.equal(credential.certificationVersionId, certification.certificationVersionId);
    assert.equal(credential.programVersionId, program.programVersionId);
    assert.equal(credential.status, 'ACTIVE');
    assert.ok(credential.expiresAt);
    assert.ok(credential.renewalDueAt);

    const completedReplay = await tx(c, () => reconcileMyLearningProgramEnrollment(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      programEnrollmentId: assigned.enrollment.programEnrollmentId,
      correlationId: 'program-reconcile-complete-replay-itest',
    }));
    assert.equal(completedReplay.newlyCompleted, false);
    assert.equal(completedReplay.issuedCredentials.length, 1);
    assert.equal(completedReplay.issuedCredentials[0]?.credentialId, credential.credentialId);

    const myCredentials = await tx(c, () => listMyLearningCredentials(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(myCredentials.length, 1);

    const issuedAtMs = Date.parse(credential.issuedAt);
    const expiringAt = new Date(issuedAtMs + 8 * 86400000);
    const expiring = await tx(c, () => reconcileLearningCredentialStatuses(c, {
      tenantId,
      learnerId: learner.learnerId,
      actorSubjectId: 'learning-admin',
      correlationId: 'credential-expiring-itest',
      now: expiringAt,
    }));
    assert.equal(expiring[0]?.status, 'EXPIRING');

    const expiredAt = new Date(issuedAtMs + 11 * 86400000);
    const expired = await tx(c, () => reconcileLearningCredentialStatuses(c, {
      tenantId,
      learnerId: learner.learnerId,
      actorSubjectId: 'learning-admin',
      correlationId: 'credential-expired-itest',
      now: expiredAt,
    }));
    assert.equal(expired[0]?.status, 'EXPIRED');

    const revoked = await tx(c, () => revokeLearningCredential(c, {
      tenantId,
      credentialId: credential.credentialId,
      actorSubjectId: 'learning-admin',
      reason: 'Credential withdrawn for integration proof.',
      correlationId: 'credential-revoke-itest',
    }));
    assert.equal(revoked.idempotent, false);
    assert.equal(revoked.credential.status, 'REVOKED');

    const revokeReplay = await tx(c, () => revokeLearningCredential(c, {
      tenantId,
      credentialId: credential.credentialId,
      actorSubjectId: 'learning-admin',
      reason: 'Credential withdrawn for integration proof.',
      correlationId: 'credential-revoke-replay-itest',
    }));
    assert.equal(revokeReplay.idempotent, true);

    const credentialRows = await c.query(
      `SELECT count(*)::int AS count
         FROM platform.learning_credentials
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND certification_version_id = $3::uuid`,
      [tenantId, learner.learnerId, certification.certificationVersionId],
    );
    assert.equal(credentialRows.rows[0]?.count, 1);

    const eventRows = await c.query(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND event_type IN (
            'learning.program.completed',
            'learning.credential.issued',
            'learning.credential.expiring',
            'learning.credential.expired',
            'learning.credential.revoked'
          )
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId],
    );
    assert.deepEqual(eventRows.rows, [
      { event_type: 'learning.credential.expired', count: 1 },
      { event_type: 'learning.credential.expiring', count: 1 },
      { event_type: 'learning.credential.issued', count: 1 },
      { event_type: 'learning.credential.revoked', count: 1 },
      { event_type: 'learning.program.completed', count: 1 },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});
