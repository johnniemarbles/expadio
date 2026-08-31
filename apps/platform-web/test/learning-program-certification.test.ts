import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0094_learning_program_certification_core.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-program-certification.ts');
const programs = read('../app/api/learning/programs/route.ts');
const certifications = read('../app/api/learning/certifications/route.ts');
const credentials = read('../app/api/learning/credentials/route.ts');
const minePrograms = read('../app/api/learning/me/programs/route.ts');
const mineCredentials = read('../app/api/learning/me/credentials/route.ts');
const reconcileProgram = read('../app/api/learning/me/program-enrollments/[id]/reconcile/route.ts');

test('program/certification administration is tenant-contextual and admin-only', () => {
  for (const source of [programs, certifications, credentials]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
  }
});

test('learner program and credential routes bind authenticated subject plus issuer', () => {
  for (const source of [minePrograms, mineCredentials, reconcileProgram]) {
    assert.match(source, /subjectId: context\.subjectId/);
    assert.match(source, /subjectIssuer: context\.issuer \?\? null/);
    assert.doesNotMatch(source, /hasLearningAuthoringRole/);
  }
});

test('program/certification versions and program item requirements are immutable after publish', () => {
  assert.match(migration, /non-draft learning program versions are immutable/);
  assert.match(migration, /learning program items may mutate only while version is DRAFT/);
  assert.match(migration, /non-draft learning certification versions are immutable/);
  assert.match(migration, /learning program enrollment identity is immutable/);
  assert.match(migration, /learning credential identity and issuance are immutable/);
  assert.match(migration, /learning credential certification and program versions must match/);
});

test('all LMS-04 tenant-owned tables use FORCE RLS', () => {
  for (const table of [
    'learning_programs',
    'learning_program_versions',
    'learning_program_items',
    'learning_program_enrollments',
    'learning_certifications',
    'learning_certification_versions',
    'learning_credentials',
  ]) {
    assert.match(
      migration,
      new RegExp('ALTER TABLE platform\\.' + table + ' FORCE ROW LEVEL SECURITY'),
    );
  }
});

test('program reconciliation reuses course/assessment evidence and existing event outbox', () => {
  assert.match(runtime, /platform\.learning_enrollments course_enrollment/);
  assert.match(runtime, /platform\.learning_assessment_attempts attempt/);
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /learning\.program\.completed/);
  assert.match(runtime, /learning\.credential\.issued/);
  assert.match(runtime, /learning\.credential\.expiring/);
  assert.match(runtime, /learning\.credential\.expired/);
  assert.match(runtime, /learning\.credential\.revoked/);
});

test('credential issuance is idempotent at database and runtime layers', () => {
  assert.match(migration, /UNIQUE \(tenant_id, learner_id, certification_version_id\)/);
  assert.match(runtime, /ON CONFLICT \(tenant_id, learner_id, certification_version_id\)/);
  assert.match(runtime, /loadCredentialByLearnerCertification/);
});
