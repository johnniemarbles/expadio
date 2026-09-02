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
  publishLearningCertificationVersion,
  publishLearningProgramVersion,
  reconcileLearningCredentialStatuses,
  reconcileMyLearningProgramEnrollment,
} from '@expadio/postgres-runtime/learning-program-certification';
import {
  createLearningCompetencyFramework,
  listMyLearningCompetencies,
  publishLearningCompetencyFrameworkVersion,
  reconcileMyLearningCompetencies,
} from '@expadio/postgres-runtime/learning-competency';

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

test('competency reconciliation promotes, downgrades and lapses from pinned evidence', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const learnerSubject = 'competency-learner-' + randomUUID();
    const issuer = 'https://clerk.expadio.com';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Competency Tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, name
       ) VALUES ($1::uuid, $2::uuid, 'Competency Org')`,
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
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'itest-competency', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () => activateLearningModule(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-activate-itest',
    }));

    const course = await tx(c, () => createLearningCourse(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-course-create-itest',
      courseKey: 'competency.privacy.course',
      draft: {
        title: 'Privacy Foundations',
        language: 'en-CA',
        visibility: 'TENANT',
        learningObjectives: ['Apply minimum-necessary privacy controls'],
        modules: [{
          moduleKey: 'privacy',
          title: 'Privacy',
          position: 1,
          lessons: [{
            lessonKey: 'foundation',
            title: 'Privacy Foundation',
            activityType: 'TEXT',
            position: 1,
            required: true,
            estimatedMinutes: 5,
            content: { body: 'Use only the minimum required data.' },
          }],
        }],
      },
    }));
    await tx(c, () => publishLearningCourseVersion(c, {
      tenantId,
      courseId: course.courseId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-course-publish-itest',
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
        fullName: 'Competency Learner',
        email: 'competency@example.com',
        audienceType: 'INTERNAL',
      },
    }));

    const courseEnrollment = await tx(c, () => createLearningEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-course-enroll-itest',
      enrollment: {
        assignmentKey: 'manual:competency-course:' + learner.learnerId,
        learnerId: learner.learnerId,
        courseId: course.courseId,
        sourceType: 'MANUAL',
      },
    }));

    const bank = await tx(c, () => createLearningQuestionBank(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      bankKey: 'competency.privacy.bank',
      name: 'Privacy Competency Bank',
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
      correlationId: 'competency-question-publish-itest',
    }));

    const assessment = await tx(c, () => createLearningAssessment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      assessmentKey: 'competency.privacy.exam',
      draft: {
        title: 'Privacy Competency Exam',
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
      correlationId: 'competency-assessment-publish-itest',
    }));

    const program = await tx(c, () => createLearningProgram(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      programKey: 'competency.privacy.program',
      draft: {
        title: 'Privacy Practice Program',
        description: 'Course plus final privacy assessment.',
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
      correlationId: 'competency-program-publish-itest',
    }));

    const certification = await tx(c, () => createLearningCertification(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      certificationKey: 'competency.privacy.certified',
      draft: {
        title: 'Privacy Practice Certified',
        description: 'Finite privacy practice credential.',
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
      correlationId: 'competency-certification-publish-itest',
    }));

    const programEnrollment = await tx(c, () => createLearningProgramEnrollment(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-program-enroll-itest',
      learnerId: learner.learnerId,
      programId: program.programId,
      assignmentKey: 'manual:competency-program:' + learner.learnerId,
      sourceType: 'MANUAL',
    }));

    const framework = await tx(c, () => createLearningCompetencyFramework(c, {
      tenantId,
      actorSubjectId: 'learning-admin',
      frameworkKey: 'privacy.practice.framework',
      draft: {
        title: 'Privacy Practice Framework',
        description: 'Cumulative proficiency plus credential currency.',
        competencies: [
          {
            competencyKey: 'privacy.practice',
            title: 'Privacy Practice',
            description: 'Demonstrates progressively stronger privacy practice.',
            levels: [
              {
                levelKey: 'aware',
                name: 'Aware',
                rank: 1,
                evidenceRules: [{
                  type: 'COURSE_COMPLETION',
                  courseVersionId,
                  required: true,
                }],
              },
              {
                levelKey: 'practitioner',
                name: 'Practitioner',
                rank: 2,
                evidenceRules: [{
                  type: 'ASSESSMENT_PASS',
                  assessmentVersionId: assessment.assessmentVersionId,
                  required: true,
                }],
              },
              {
                levelKey: 'certified',
                name: 'Certified',
                rank: 3,
                evidenceRules: [{
                  type: 'CREDENTIAL_ACTIVE',
                  certificationVersionId: certification.certificationVersionId,
                  required: true,
                }],
              },
            ],
          },
          {
            competencyKey: 'privacy.credential.currency',
            title: 'Privacy Credential Currency',
            description: 'Requires a currently valid credential.',
            levels: [{
              levelKey: 'current',
              name: 'Current',
              rank: 1,
              evidenceRules: [{
                type: 'CREDENTIAL_ACTIVE',
                certificationVersionId: certification.certificationVersionId,
                required: true,
              }],
            }],
          },
        ],
      },
    }));
    await tx(c, () => publishLearningCompetencyFrameworkVersion(c, {
      tenantId,
      competencyFrameworkId: framework.competencyFrameworkId,
      version: 1,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-framework-publish-itest',
    }));

    const empty = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-empty-itest',
    }));
    assert.equal(empty.competencies.length, 2);
    assert.equal(
      empty.competencies.find((item) => item.competencyKey === 'privacy.practice')?.status,
      'NOT_ACHIEVED',
    );
    assert.equal(empty.eventsEmitted, 0);

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
      correlationId: 'competency-course-complete-itest',
    }));

    const aware = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-aware-itest',
    }));
    const awarePractice = aware.competencies.find(
      (item) => item.competencyKey === 'privacy.practice',
    );
    assert.equal(awarePractice?.status, 'ACTIVE');
    assert.equal(awarePractice?.currentLevel?.levelKey, 'aware');
    assert.equal(aware.eventsEmitted, 1);

    const awareReplay = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-aware-replay-itest',
    }));
    assert.equal(awareReplay.eventsEmitted, 0);

    const attempt = await tx(c, () => startMyAssessmentAttempt(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      assessmentId: assessment.assessmentId,
      enrollmentId: courseEnrollment.enrollment.enrollmentId,
      attemptKey: 'competency-assessment:' + learner.learnerId,
      correlationId: 'competency-assessment-start-itest',
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
      correlationId: 'competency-assessment-pass-itest',
    }));
    assert.equal(passed.passed, true);

    const practitioner = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-practitioner-itest',
    }));
    const practitionerPractice = practitioner.competencies.find(
      (item) => item.competencyKey === 'privacy.practice',
    );
    assert.equal(practitionerPractice?.currentLevel?.levelKey, 'practitioner');
    assert.equal(practitioner.eventsEmitted, 1);

    await assert.rejects(
      () => tx(c, () => reconcileMyLearningCompetencies(c, {
        tenantId,
        subjectId: 'different-subject',
        subjectIssuer: issuer,
        correlationId: 'competency-cross-subject-itest',
      })),
      /LEARNING_LEARNER_NOT_FOUND/,
    );

    const programCompleted = await tx(c, () => reconcileMyLearningProgramEnrollment(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      programEnrollmentId: programEnrollment.enrollment.programEnrollmentId,
      correlationId: 'competency-program-complete-itest',
    }));
    assert.equal(programCompleted.enrollment.status, 'COMPLETED');
    assert.equal(programCompleted.issuedCredentials.length, 1);
    const credential = programCompleted.issuedCredentials[0];
    assert.ok(credential);

    const certified = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-certified-itest',
    }));
    const certifiedPractice = certified.competencies.find(
      (item) => item.competencyKey === 'privacy.practice',
    );
    const currency = certified.competencies.find(
      (item) => item.competencyKey === 'privacy.credential.currency',
    );
    assert.equal(certifiedPractice?.currentLevel?.levelKey, 'certified');
    assert.equal(currency?.status, 'ACTIVE');
    assert.equal(currency?.currentLevel?.levelKey, 'current');
    assert.equal(certified.eventsEmitted, 2);

    const issuedAtMs = Date.parse(credential.issuedAt);
    const expiredAt = new Date(issuedAtMs + 11 * 86400000);
    const credentials = await tx(c, () => reconcileLearningCredentialStatuses(c, {
      tenantId,
      learnerId: learner.learnerId,
      actorSubjectId: 'learning-admin',
      correlationId: 'competency-credential-expired-itest',
      now: expiredAt,
    }));
    assert.equal(credentials[0]?.status, 'EXPIRED');

    const afterExpiry = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-after-expiry-itest',
      now: expiredAt,
    }));
    const downgraded = afterExpiry.competencies.find(
      (item) => item.competencyKey === 'privacy.practice',
    );
    const lapsed = afterExpiry.competencies.find(
      (item) => item.competencyKey === 'privacy.credential.currency',
    );
    assert.equal(downgraded?.status, 'ACTIVE');
    assert.equal(downgraded?.currentLevel?.levelKey, 'practitioner');
    assert.equal(lapsed?.status, 'LAPSED');
    assert.equal(lapsed?.currentLevel?.levelKey, 'current');
    assert.equal(afterExpiry.eventsEmitted, 2);

    const afterExpiryReplay = await tx(c, () => reconcileMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
      correlationId: 'competency-after-expiry-replay-itest',
      now: expiredAt,
    }));
    assert.equal(afterExpiryReplay.eventsEmitted, 0);

    const storedEvidence = await c.query<{
      evidence_type: string;
      currently_valid: boolean;
      source_id: string;
    }>(
      `SELECT evidence_type, currently_valid, source_id
         FROM platform.learning_competency_evidence
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
        ORDER BY evidence_type, competency_evidence_rule_id`,
      [tenantId, learner.learnerId],
    );
    const credentialEvidence = storedEvidence.rows.filter(
      (row) => row.evidence_type === 'CREDENTIAL_ACTIVE',
    );
    assert.equal(credentialEvidence.length, 2);
    assert.equal(credentialEvidence.every((row) => row.currently_valid === false), true);
    assert.equal(
      credentialEvidence.every((row) => row.source_id === credential.credentialId),
      true,
    );

    const mine = await tx(c, () => listMyLearningCompetencies(c, {
      tenantId,
      subjectId: learnerSubject,
      subjectIssuer: issuer,
    }));
    assert.equal(
      mine.find((item) => item.competencyKey === 'privacy.practice')?.currentLevel?.levelKey,
      'practitioner',
    );
    assert.equal(
      mine.find((item) => item.competencyKey === 'privacy.credential.currency')?.status,
      'LAPSED',
    );

    const events = await c.query<{ event_type: string; count: number }>(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND event_type IN (
            'learning.competency.achieved',
            'learning.competency.level.changed',
            'learning.competency.lapsed'
          )
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId],
    );
    assert.deepEqual(events.rows, [
      { event_type: 'learning.competency.achieved', count: 2 },
      { event_type: 'learning.competency.lapsed', count: 1 },
      { event_type: 'learning.competency.level.changed', count: 3 },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});
