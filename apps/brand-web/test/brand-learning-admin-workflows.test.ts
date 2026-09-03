import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand Learning operational sections use tenant-admin guarded write boundaries', () => {
  for (const route of [
    '../app/api/learning/assessments/route.ts',
    '../app/api/learning/programs/route.ts',
    '../app/api/learning/competency-frameworks/route.ts',
    '../app/api/learning/assignment-rules/route.ts',
    '../app/api/learning/question-banks/route.ts',
  ]) {
    const source = read(route);
    assert.match(source, /hasLearningAdmin/);
    assert.match(source, /withBrandTransaction/);
    assert.doesNotMatch(source, /tenant_module_entitlements.*INSERT|INSERT.*tenant_module_entitlements/s);
    assert.doesNotMatch(source, /platform-web/);
  }
});

test('Brand Learning section UI exposes real create workflows instead of read-only tables', () => {
  const page = read('../app/(workspace)/learning/[section]/page.tsx');
  const panel = read('../components/LearningSectionAdminPanel.tsx');
  const assessment = read('../components/AssessmentAuthoringPanel.tsx');
  const program = read('../components/ProgramAuthoringPanel.tsx');

  assert.match(page, /LearningSectionAdminPanel/);
  assert.match(page, /AssessmentAuthoringPanel/);
  assert.match(page, /ProgramAuthoringPanel/);
  assert.match(page, /hasLearningAdmin/);
  assert.match(program, /\/api\/learning\/programs/);
  assert.match(panel, /\/api\/learning\/competency-frameworks/);
  assert.match(panel, /\/api\/learning\/assignment-rules/);
  assert.match(assessment, /\/api\/learning\/question-banks/);
  assert.match(assessment, /Create & publish question/);
  assert.match(assessment, /\/api\/learning\/assessments/);
  assert.match(assessment, /Create & publish assessment/);
  assert.match(program, /Create & publish program/);
  assert.match(program, /Create & publish certification/);
  assert.match(program, /Assign program/);
  assert.match(panel, /Create competency framework/);
  assert.match(panel, /Create assignment rule/);
});

test('Assignment rules only target tenant-visible published course or program options', () => {
  const page = read('../app/(workspace)/learning/[section]/page.tsx');
  assert.match(page, /currentPublishedVersion !== null/);
  assert.match(page, /course\.status === 'ACTIVE'/);
  assert.match(page, /program\.status === 'ACTIVE'/);
});


test('assessment authoring composes only published question versions against a published course version', () => {
  const page = read('../app/(workspace)/learning/[section]/page.tsx');
  const assessment = read('../components/AssessmentAuthoringPanel.tsx');
  const questionPublish = read('../app/api/learning/questions/[id]/versions/[version]/publish/route.ts');
  const assessmentPublish = read('../app/api/learning/assessments/[id]/versions/[version]/publish/route.ts');

  assert.match(page, /listLearningPublishedQuestions/);
  assert.match(page, /loadLearningCourseVersion/);
  assert.match(page, /courseVersionId/);
  assert.match(assessment, /selectedQuestions\.map/);
  assert.match(assessment, /questionVersionId/);
  assert.match(questionPublish, /publishLearningQuestionVersion/);
  assert.match(assessmentPublish, /publishLearningAssessmentVersion/);
  assert.match(questionPublish, /hasLearningAdmin/);
  assert.match(assessmentPublish, /hasLearningAdmin/);
});


test('program authoring pins immutable requirements and governs certification plus assignment', () => {
  const page = read('../app/(workspace)/learning/[section]/page.tsx');
  const program = read('../components/ProgramAuthoringPanel.tsx');
  const publishProgram = read('../app/api/learning/programs/[id]/versions/[version]/publish/route.ts');
  const certifications = read('../app/api/learning/certifications/route.ts');
  const publishCertification = read('../app/api/learning/certifications/[id]/versions/[version]/publish/route.ts');
  const assignment = read('../app/api/learning/program-enrollments/route.ts');

  assert.match(page, /listLearningPublishedAssessmentVersions/);
  assert.match(page, /listLearningPublishedProgramVersions/);
  assert.match(page, /listLearningLearners/);
  assert.match(program, /courseVersionId/);
  assert.match(program, /assessmentVersionId/);
  assert.match(program, /required: true/);
  assert.match(publishProgram, /publishLearningProgramVersion/);
  assert.match(certifications, /createLearningCertification/);
  assert.match(publishCertification, /publishLearningCertificationVersion/);
  assert.match(assignment, /createLearningProgramEnrollment/);

  for (const source of [publishProgram, certifications, publishCertification, assignment]) {
    assert.match(source, /hasLearningAdmin/);
    assert.match(source, /withBrandTransaction/);
    assert.doesNotMatch(source, /platform-web/);
  }
});
