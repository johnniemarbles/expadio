import { randomUUID } from 'node:crypto';
import {
  credentialStatusAt,
  assertLearningProgramPublishable,
  validateLearningCertificationDraft,
  validateLearningProgramDraft,
  type LearningCredentialStatus,
  type LearningProgramEnrollmentStatus,
  type LearningProgramItemType,
} from '@expadio/learning';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { requireTenantModuleOperational } from './product-module.ts';

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ASSIGNMENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProgramVersionRow {
  readonly program_version_id: string;
  readonly program_id: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly title: string;
  readonly description: string;
}

interface CertificationVersionRow {
  readonly certification_version_id: string;
  readonly certification_id: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly title: string;
  readonly description: string;
  readonly program_version_id: string;
  readonly validity_days: number | null;
  readonly renewal_window_days: number | null;
}

interface ProgramEnrollmentRow {
  readonly program_enrollment_id: string;
  readonly learner_id: string;
  readonly program_id: string;
  readonly program_version_id: string;
  readonly assignment_key: string;
  readonly source_type: 'MANUAL' | 'RULE' | 'IMPORT' | 'SELF';
  readonly status: LearningProgramEnrollmentStatus;
  readonly assigned_by_subject_id: string;
  readonly assigned_at: Date | string;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly completion_percent: string | number;
  readonly last_reconciled_at: Date | string | null;
}

interface ProgramEnrollmentListRow extends ProgramEnrollmentRow {
  readonly program_key: string;
  readonly program_version: number;
  readonly program_title: string;
  readonly learner_name: string;
}

interface CredentialRow {
  readonly credential_id: string;
  readonly credential_key: string;
  readonly certification_id: string;
  readonly certification_version_id: string;
  readonly certification_version: number;
  readonly certification_key: string;
  readonly certification_title: string;
  readonly program_enrollment_id: string;
  readonly learner_id: string;
  readonly program_version_id: string;
  readonly status: LearningCredentialStatus;
  readonly issued_at: Date | string;
  readonly renewal_due_at: Date | string | null;
  readonly expires_at: Date | string | null;
  readonly revoked_at: Date | string | null;
  readonly revocation_reason: string | null;
}

export interface LearningPublishedProgramVersionSummary {
  readonly programId: string;
  readonly programKey: string;
  readonly programVersionId: string;
  readonly version: number;
  readonly title: string;
}

export interface LearningProgramSummary {
  readonly programId: string;
  readonly programKey: string;
  readonly currentPublishedVersion: number | null;
  readonly publishedTitle: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

export interface LearningProgramEnrollmentSummary {
  readonly programEnrollmentId: string;
  readonly learnerId: string;
  readonly learnerName: string;
  readonly assignmentKey: string;
  readonly sourceType: 'MANUAL' | 'RULE' | 'IMPORT' | 'SELF';
  readonly programId: string;
  readonly programKey: string;
  readonly programVersionId: string;
  readonly programVersion: number;
  readonly programTitle: string;
  readonly status: LearningProgramEnrollmentStatus;
  readonly assignedBySubjectId: string;
  readonly assignedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly completionPercent: number;
  readonly lastReconciledAt: string | null;
}

export interface LearningProgramReconciliation {
  readonly enrollment: LearningProgramEnrollmentSummary;
  readonly requirements: readonly {
    readonly type: LearningProgramItemType;
    readonly position: number;
    readonly required: boolean;
    readonly courseVersionId: string | null;
    readonly assessmentVersionId: string | null;
    readonly completed: boolean;
  }[];
  readonly newlyCompleted: boolean;
  readonly issuedCredentials: readonly LearningCredentialSummary[];
}

export interface LearningCertificationSummary {
  readonly certificationId: string;
  readonly certificationKey: string;
  readonly currentPublishedVersion: number | null;
  readonly publishedTitle: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

export interface LearningCredentialSummary {
  readonly credentialId: string;
  readonly credentialKey: string;
  readonly certificationId: string;
  readonly certificationKey: string;
  readonly certificationVersionId: string;
  readonly certificationVersion: number;
  readonly certificationTitle: string;
  readonly programEnrollmentId: string;
  readonly learnerId: string;
  readonly programVersionId: string;
  readonly status: LearningCredentialStatus;
  readonly effectiveStatus: LearningCredentialStatus;
  readonly issuedAt: string;
  readonly renewalDueAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function number(value: string | number): number {
  return Number(value);
}

function stableKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LEARNING_${field.toUpperCase()}_REQUIRED`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 160 || !KEY.test(normalized)) {
    throw new Error(`LEARNING_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function stableUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw new Error(`LEARNING_${field.toUpperCase()}_INVALID`);
  }
  return value.trim();
}

function stableAssignmentKey(value: unknown): string {
  if (typeof value !== 'string' || !ASSIGNMENT_KEY.test(value.trim())) {
    throw new Error('LEARNING_PROGRAM_ASSIGNMENT_KEY_INVALID');
  }
  return value.trim();
}

async function requireLearning(client: PostgresClient, tenantId: string): Promise<void> {
  await requireTenantModuleOperational(client, { tenantId, moduleKey: 'learning' });
}

async function defaultAcademyId(client: PostgresClient, tenantId: string): Promise<string> {
  const result = await client.query<{ readonly academy_id: string }>(
    `SELECT academy_id
       FROM platform.learning_academies
      WHERE tenant_id = $1::uuid
        AND is_default = true
        AND status = 'ACTIVE'
      LIMIT 1`,
    [tenantId],
  );
  const academyId = result.rows[0]?.academy_id;
  if (academyId === undefined) throw new Error('LEARNING_DEFAULT_ACADEMY_MISSING');
  return academyId;
}

function enrollment(row: ProgramEnrollmentListRow): LearningProgramEnrollmentSummary {
  return {
    programEnrollmentId: row.program_enrollment_id,
    learnerId: row.learner_id,
    learnerName: row.learner_name,
    assignmentKey: row.assignment_key,
    sourceType: row.source_type,
    programId: row.program_id,
    programKey: row.program_key,
    programVersionId: row.program_version_id,
    programVersion: row.program_version,
    programTitle: row.program_title,
    status: row.status,
    assignedBySubjectId: row.assigned_by_subject_id,
    assignedAt: iso(row.assigned_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    completionPercent: number(row.completion_percent),
    lastReconciledAt: nullableIso(row.last_reconciled_at),
  };
}

function credential(row: CredentialRow, now = new Date()): LearningCredentialSummary {
  const expiresAt = nullableIso(row.expires_at);
  const renewalDueAt = nullableIso(row.renewal_due_at);
  return {
    credentialId: row.credential_id,
    credentialKey: row.credential_key,
    certificationId: row.certification_id,
    certificationKey: row.certification_key,
    certificationVersionId: row.certification_version_id,
    certificationVersion: row.certification_version,
    certificationTitle: row.certification_title,
    programEnrollmentId: row.program_enrollment_id,
    learnerId: row.learner_id,
    programVersionId: row.program_version_id,
    status: row.status,
    effectiveStatus: credentialStatusAt({
      currentStatus: row.status,
      expiresAt,
      renewalDueAt,
    }, now),
    issuedAt: iso(row.issued_at),
    renewalDueAt,
    expiresAt,
    revokedAt: nullableIso(row.revoked_at),
    revocationReason: row.revocation_reason,
  };
}

export async function createLearningProgram(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly programKey: unknown;
    readonly draft: unknown;
  },
): Promise<{
  readonly programId: string;
  readonly programKey: string;
  readonly programVersionId: string;
  readonly version: 1;
  readonly state: 'DRAFT';
}> {
  await requireLearning(client, input.tenantId);
  const programKey = stableKey(input.programKey, 'program_key');
  const draft = validateLearningProgramDraft(input.draft);
  assertLearningProgramPublishable(draft);
  const academyId = await defaultAcademyId(client, input.tenantId);

  const courseIds = draft.items
    .filter((item) => item.courseVersionId !== null)
    .map((item) => item.courseVersionId!);
  if (courseIds.length > 0) {
    const rows = await client.query<{ readonly course_version_id: string; readonly state: string }>(
      `SELECT course_version_id, state
         FROM platform.learning_course_versions
        WHERE tenant_id = $1::uuid
          AND course_version_id = ANY($2::uuid[])`,
      [input.tenantId, courseIds],
    );
    if (rows.rows.length !== courseIds.length) throw new Error('LEARNING_PROGRAM_COURSE_VERSION_NOT_FOUND');
    if (rows.rows.some((row) => !['PUBLISHED','SUPERSEDED'].includes(row.state))) {
      throw new Error('LEARNING_PROGRAM_COURSE_VERSION_NOT_PUBLISHED');
    }
  }

  const assessmentIds = draft.items
    .filter((item) => item.assessmentVersionId !== null)
    .map((item) => item.assessmentVersionId!);
  if (assessmentIds.length > 0) {
    const rows = await client.query<{ readonly assessment_version_id: string; readonly state: string }>(
      `SELECT assessment_version_id, state
         FROM platform.learning_assessment_versions
        WHERE tenant_id = $1::uuid
          AND assessment_version_id = ANY($2::uuid[])`,
      [input.tenantId, assessmentIds],
    );
    if (rows.rows.length !== assessmentIds.length) {
      throw new Error('LEARNING_PROGRAM_ASSESSMENT_VERSION_NOT_FOUND');
    }
    if (rows.rows.some((row) => !['PUBLISHED','SUPERSEDED'].includes(row.state))) {
      throw new Error('LEARNING_PROGRAM_ASSESSMENT_VERSION_NOT_PUBLISHED');
    }
  }

  try {
    const programResult = await client.query<{ readonly program_id: string }>(
      `INSERT INTO platform.learning_programs (
         tenant_id, academy_id, program_key, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING program_id`,
      [input.tenantId, academyId, programKey, input.actorSubjectId],
    );
    const programId = programResult.rows[0]?.program_id;
    if (programId === undefined) throw new Error('LEARNING_PROGRAM_INSERT_FAILED');

    const versionResult = await client.query<{ readonly program_version_id: string }>(
      `INSERT INTO platform.learning_program_versions (
         tenant_id, program_id, version, state, title, description,
         created_by_subject_id, updated_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', $3, $4, $5, $5
       )
       RETURNING program_version_id`,
      [input.tenantId, programId, draft.title, draft.description, input.actorSubjectId],
    );
    const programVersionId = versionResult.rows[0]?.program_version_id;
    if (programVersionId === undefined) throw new Error('LEARNING_PROGRAM_VERSION_INSERT_FAILED');

    for (const item of draft.items) {
      await client.query(
        `INSERT INTO platform.learning_program_items (
           tenant_id, program_version_id, item_type, course_version_id,
           assessment_version_id, position, required
         ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7)`,
        [
          input.tenantId,
          programVersionId,
          item.type,
          item.courseVersionId,
          item.assessmentVersionId,
          item.position,
          item.required,
        ],
      );
    }

    return { programId, programKey, programVersionId, version: 1, state: 'DRAFT' };
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_PROGRAM_KEY_EXISTS');
    throw error;
  }
}

export async function listLearningPublishedProgramVersions(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningPublishedProgramVersionSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly program_id: string;
    readonly program_key: string;
    readonly program_version_id: string;
    readonly version: number;
    readonly title: string;
  }>(
    `SELECT program.program_id, program.program_key,
            version.program_version_id, version.version, version.title
       FROM platform.learning_programs program
       JOIN platform.learning_program_versions version
         ON version.program_id = program.program_id
        AND version.tenant_id = program.tenant_id
        AND version.version = program.current_published_version
        AND version.state = 'PUBLISHED'
      WHERE program.tenant_id = $1::uuid
        AND program.status = 'ACTIVE'
      ORDER BY version.title, program.program_key`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    programId: row.program_id,
    programKey: row.program_key,
    programVersionId: row.program_version_id,
    version: row.version,
    title: row.title,
  }));
}

export async function listLearningPrograms(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningProgramSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly program_id: string;
    readonly program_key: string;
    readonly current_published_version: number | null;
    readonly published_title: string | null;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  }>(
    `SELECT program.program_id, program.program_key,
            program.current_published_version,
            version.title AS published_title, program.status
       FROM platform.learning_programs program
       LEFT JOIN platform.learning_program_versions version
         ON version.program_id = program.program_id
        AND version.tenant_id = program.tenant_id
        AND version.state = 'PUBLISHED'
      WHERE program.tenant_id = $1::uuid
      ORDER BY program.updated_at DESC, program.program_key`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    programId: row.program_id,
    programKey: row.program_key,
    currentPublishedVersion: row.current_published_version,
    publishedTitle: row.published_title,
    status: row.status,
  }));
}

export async function publishLearningProgramVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly programId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly programVersionId: string; readonly version: number; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.programId, 'program_id');

  const program = await client.query(
    `SELECT 1
       FROM platform.learning_programs
      WHERE tenant_id = $1::uuid
        AND program_id = $2::uuid
        AND status = 'ACTIVE'
      FOR UPDATE`,
    [input.tenantId, input.programId],
  );
  if (program.rows[0] === undefined) throw new Error('LEARNING_PROGRAM_NOT_FOUND');

  const versions = await client.query<ProgramVersionRow>(
    `SELECT program_version_id, program_id, version, state, title, description
       FROM platform.learning_program_versions
      WHERE tenant_id = $1::uuid
        AND program_id = $2::uuid
        AND version = $3
      FOR UPDATE`,
    [input.tenantId, input.programId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) throw new Error('LEARNING_PROGRAM_VERSION_NOT_FOUND');
  if (target.state === 'PUBLISHED') {
    return { programVersionId: target.program_version_id, version: target.version, idempotent: true };
  }
  if (target.state !== 'DRAFT') throw new Error('LEARNING_PROGRAM_VERSION_NOT_PUBLISHABLE');

  await client.query(
    `UPDATE platform.learning_program_versions
        SET state = 'SUPERSEDED',
            updated_by_subject_id = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND program_id = $2::uuid
        AND state = 'PUBLISHED'
        AND version <> $4`,
    [input.tenantId, input.programId, input.actorSubjectId, input.version],
  );

  await client.query(
    `UPDATE platform.learning_program_versions
        SET state = 'PUBLISHED',
            published_by_subject_id = $4,
            published_at = now(),
            updated_by_subject_id = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND program_id = $2::uuid
        AND version = $3`,
    [input.tenantId, input.programId, input.version, input.actorSubjectId],
  );

  await client.query(
    `UPDATE platform.learning_programs
        SET current_published_version = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid AND program_id = $2::uuid`,
    [input.tenantId, input.programId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.program',
      aggregateId: input.programId,
      eventType: 'learning.program.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { programVersionId: target.program_version_id, version: input.version },
      metadata: { source: 'learning.program.authoring' },
    },
  });

  return { programVersionId: target.program_version_id, version: input.version, idempotent: false };
}

export async function createLearningCertification(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly certificationKey: unknown;
    readonly draft: unknown;
  },
): Promise<{
  readonly certificationId: string;
  readonly certificationKey: string;
  readonly certificationVersionId: string;
  readonly version: 1;
  readonly state: 'DRAFT';
}> {
  await requireLearning(client, input.tenantId);
  const certificationKey = stableKey(input.certificationKey, 'certification_key');
  const draft = validateLearningCertificationDraft(input.draft);
  const academyId = await defaultAcademyId(client, input.tenantId);

  const program = await client.query<{ readonly state: string }>(
    `SELECT state
       FROM platform.learning_program_versions
      WHERE tenant_id = $1::uuid
        AND program_version_id = $2::uuid`,
    [input.tenantId, draft.programVersionId],
  );
  const programState = program.rows[0]?.state;
  if (programState !== 'PUBLISHED' && programState !== 'SUPERSEDED') {
    throw new Error('LEARNING_CERTIFICATION_PROGRAM_VERSION_NOT_PUBLISHED');
  }

  try {
    const certificationResult = await client.query<{ readonly certification_id: string }>(
      `INSERT INTO platform.learning_certifications (
         tenant_id, academy_id, certification_key, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING certification_id`,
      [input.tenantId, academyId, certificationKey, input.actorSubjectId],
    );
    const certificationId = certificationResult.rows[0]?.certification_id;
    if (certificationId === undefined) throw new Error('LEARNING_CERTIFICATION_INSERT_FAILED');

    const versionResult = await client.query<{ readonly certification_version_id: string }>(
      `INSERT INTO platform.learning_certification_versions (
         tenant_id, certification_id, version, state, title, description,
         program_version_id, validity_days, renewal_window_days,
         created_by_subject_id, updated_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', $3, $4,
         $5::uuid, $6, $7, $8, $8
       )
       RETURNING certification_version_id`,
      [
        input.tenantId,
        certificationId,
        draft.title,
        draft.description,
        draft.programVersionId,
        draft.validityDays,
        draft.renewalWindowDays,
        input.actorSubjectId,
      ],
    );
    const certificationVersionId = versionResult.rows[0]?.certification_version_id;
    if (certificationVersionId === undefined) {
      throw new Error('LEARNING_CERTIFICATION_VERSION_INSERT_FAILED');
    }

    return {
      certificationId,
      certificationKey,
      certificationVersionId,
      version: 1,
      state: 'DRAFT',
    };
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('LEARNING_CERTIFICATION_KEY_EXISTS');
    throw error;
  }
}

export async function listLearningCertifications(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningCertificationSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly certification_id: string;
    readonly certification_key: string;
    readonly current_published_version: number | null;
    readonly published_title: string | null;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  }>(
    `SELECT certification.certification_id, certification.certification_key,
            certification.current_published_version,
            version.title AS published_title, certification.status
       FROM platform.learning_certifications certification
       LEFT JOIN platform.learning_certification_versions version
         ON version.certification_id = certification.certification_id
        AND version.tenant_id = certification.tenant_id
        AND version.state = 'PUBLISHED'
      WHERE certification.tenant_id = $1::uuid
      ORDER BY certification.updated_at DESC, certification.certification_key`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    certificationId: row.certification_id,
    certificationKey: row.certification_key,
    currentPublishedVersion: row.current_published_version,
    publishedTitle: row.published_title,
    status: row.status,
  }));
}

export async function publishLearningCertificationVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly certificationId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly certificationVersionId: string;
  readonly version: number;
  readonly idempotent: boolean;
}> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.certificationId, 'certification_id');

  const certification = await client.query(
    `SELECT 1
       FROM platform.learning_certifications
      WHERE tenant_id = $1::uuid
        AND certification_id = $2::uuid
        AND status = 'ACTIVE'
      FOR UPDATE`,
    [input.tenantId, input.certificationId],
  );
  if (certification.rows[0] === undefined) throw new Error('LEARNING_CERTIFICATION_NOT_FOUND');

  const versions = await client.query<CertificationVersionRow>(
    `SELECT certification_version_id, certification_id, version, state,
            title, description, program_version_id, validity_days,
            renewal_window_days
       FROM platform.learning_certification_versions
      WHERE tenant_id = $1::uuid
        AND certification_id = $2::uuid
        AND version = $3
      FOR UPDATE`,
    [input.tenantId, input.certificationId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) throw new Error('LEARNING_CERTIFICATION_VERSION_NOT_FOUND');
  if (target.state === 'PUBLISHED') {
    return {
      certificationVersionId: target.certification_version_id,
      version: target.version,
      idempotent: true,
    };
  }
  if (target.state !== 'DRAFT') throw new Error('LEARNING_CERTIFICATION_VERSION_NOT_PUBLISHABLE');

  await client.query(
    `UPDATE platform.learning_certification_versions
        SET state = 'SUPERSEDED',
            updated_by_subject_id = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND certification_id = $2::uuid
        AND state = 'PUBLISHED'
        AND version <> $4`,
    [input.tenantId, input.certificationId, input.actorSubjectId, input.version],
  );

  await client.query(
    `UPDATE platform.learning_certification_versions
        SET state = 'PUBLISHED',
            published_by_subject_id = $4,
            published_at = now(),
            updated_by_subject_id = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND certification_id = $2::uuid
        AND version = $3`,
    [input.tenantId, input.certificationId, input.version, input.actorSubjectId],
  );

  await client.query(
    `UPDATE platform.learning_certifications
        SET current_published_version = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid AND certification_id = $2::uuid`,
    [input.tenantId, input.certificationId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.certification',
      aggregateId: input.certificationId,
      eventType: 'learning.certification.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        certificationVersionId: target.certification_version_id,
        version: target.version,
        programVersionId: target.program_version_id,
      },
      metadata: { source: 'learning.certification.authoring' },
    },
  });

  return {
    certificationVersionId: target.certification_version_id,
    version: target.version,
    idempotent: false,
  };
}

export async function createLearningProgramEnrollment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly learnerId: string;
    readonly programId: string;
    readonly assignmentKey: unknown;
    readonly sourceType?: 'MANUAL' | 'RULE' | 'IMPORT' | 'SELF';
  },
): Promise<{ readonly enrollment: LearningProgramEnrollmentSummary; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.learnerId, 'learner_id');
  stableUuid(input.programId, 'program_id');
  const assignmentKey = stableAssignmentKey(input.assignmentKey);
  const sourceType = input.sourceType ?? 'MANUAL';

  const existing = await loadProgramEnrollmentByAssignmentKey(
    client,
    input.tenantId,
    assignmentKey,
  );
  if (existing !== null) {
    if (
      existing.learnerId !== input.learnerId
      || existing.programId !== input.programId
      || existing.sourceType !== sourceType
    ) {
      throw new Error('LEARNING_PROGRAM_ASSIGNMENT_KEY_CONFLICT');
    }
    return { enrollment: existing, idempotent: true };
  }

  const learner = await client.query<{ readonly status: string }>(
    `SELECT status
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid AND learner_id = $2::uuid`,
    [input.tenantId, input.learnerId],
  );
  if (learner.rows[0] === undefined) throw new Error('LEARNING_LEARNER_NOT_FOUND');
  if (learner.rows[0].status !== 'ACTIVE') throw new Error('LEARNING_LEARNER_NOT_ACTIVE');

  const program = await client.query<{
    readonly program_version_id: string;
    readonly version: number;
  }>(
    `SELECT version.program_version_id, version.version
       FROM platform.learning_programs program
       JOIN platform.learning_program_versions version
         ON version.program_id = program.program_id
        AND version.tenant_id = program.tenant_id
        AND version.version = program.current_published_version
        AND version.state = 'PUBLISHED'
      WHERE program.tenant_id = $1::uuid
        AND program.program_id = $2::uuid
        AND program.status = 'ACTIVE'`,
    [input.tenantId, input.programId],
  );
  const pinned = program.rows[0];
  if (pinned === undefined) throw new Error('LEARNING_PROGRAM_NOT_PUBLISHED');

  try {
    await client.query(
      `INSERT INTO platform.learning_program_enrollments (
         tenant_id, learner_id, program_id, program_version_id,
         assignment_key, source_type, assigned_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)`,
      [
        input.tenantId,
        input.learnerId,
        input.programId,
        pinned.program_version_id,
        assignmentKey,
        sourceType,
        input.actorSubjectId,
      ],
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      const replay = await loadProgramEnrollmentByAssignmentKey(
        client,
        input.tenantId,
        assignmentKey,
      );
      if (replay !== null) {
        if (
          replay.learnerId !== input.learnerId
          || replay.programId !== input.programId
          || replay.sourceType !== sourceType
        ) {
          throw new Error('LEARNING_PROGRAM_ASSIGNMENT_KEY_CONFLICT');
        }
        return { enrollment: replay, idempotent: true };
      }
    }
    throw error;
  }

  const created = await loadProgramEnrollmentByAssignmentKey(
    client,
    input.tenantId,
    assignmentKey,
  );
  if (created === null) throw new Error('LEARNING_PROGRAM_ENROLLMENT_INSERT_FAILED');

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.program_enrollment',
      aggregateId: created.programEnrollmentId,
      eventType: 'learning.program.enrollment.created',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        learnerId: input.learnerId,
        programId: input.programId,
        programVersionId: pinned.program_version_id,
        programVersion: pinned.version,
        assignmentKey,
        sourceType,
      },
      metadata: { source: 'learning.program.assignment' },
    },
  });

  return { enrollment: created, idempotent: false };
}

export async function listLearningProgramEnrollments(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId?: string;
  },
): Promise<readonly LearningProgramEnrollmentSummary[]> {
  await requireLearning(client, input.tenantId);
  const result = await client.query<ProgramEnrollmentListRow>(
    `SELECT enrollment.*, learner.full_name AS learner_name,
            program.program_key, version.version AS program_version,
            version.title AS program_title
       FROM platform.learning_program_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id = enrollment.learner_id
        AND learner.tenant_id = enrollment.tenant_id
       JOIN platform.learning_programs program
         ON program.program_id = enrollment.program_id
        AND program.tenant_id = enrollment.tenant_id
       JOIN platform.learning_program_versions version
         ON version.program_version_id = enrollment.program_version_id
        AND version.tenant_id = enrollment.tenant_id
      WHERE enrollment.tenant_id = $1::uuid
        AND ($2::uuid IS NULL OR enrollment.learner_id = $2::uuid)
      ORDER BY enrollment.assigned_at DESC, enrollment.program_enrollment_id`,
    [input.tenantId, input.learnerId ?? null],
  );
  return result.rows.map(enrollment);
}

export async function listMyLearningPrograms(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
  },
): Promise<readonly LearningProgramEnrollmentSummary[]> {
  await requireLearning(client, input.tenantId);
  const learnerId = await resolveActiveLearnerId(client, input);
  return listLearningProgramEnrollments(client, {
    tenantId: input.tenantId,
    learnerId,
  });
}

export async function reconcileLearningProgramEnrollment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly programEnrollmentId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly expectedLearnerId?: string;
  },
): Promise<LearningProgramReconciliation> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.programEnrollmentId, 'program_enrollment_id');

  const locked = await client.query<ProgramEnrollmentListRow>(
    `SELECT enrollment.*, learner.full_name AS learner_name,
            program.program_key, version.version AS program_version,
            version.title AS program_title
       FROM platform.learning_program_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id = enrollment.learner_id
        AND learner.tenant_id = enrollment.tenant_id
       JOIN platform.learning_programs program
         ON program.program_id = enrollment.program_id
        AND program.tenant_id = enrollment.tenant_id
       JOIN platform.learning_program_versions version
         ON version.program_version_id = enrollment.program_version_id
        AND version.tenant_id = enrollment.tenant_id
      WHERE enrollment.tenant_id = $1::uuid
        AND enrollment.program_enrollment_id = $2::uuid
        AND ($3::uuid IS NULL OR enrollment.learner_id = $3::uuid)
      FOR UPDATE OF enrollment`,
    [
      input.tenantId,
      input.programEnrollmentId,
      input.expectedLearnerId ?? null,
    ],
  );
  const current = locked.rows[0];
  if (current === undefined) throw new Error('LEARNING_PROGRAM_ENROLLMENT_NOT_FOUND');
  if (current.status === 'CANCELLED') throw new Error('LEARNING_PROGRAM_ENROLLMENT_CANCELLED');

  const items = await client.query<{
    readonly item_type: LearningProgramItemType;
    readonly position: number;
    readonly required: boolean;
    readonly course_version_id: string | null;
    readonly assessment_version_id: string | null;
    readonly completed: boolean;
  }>(
    `SELECT item.item_type, item.position, item.required,
            item.course_version_id, item.assessment_version_id,
            CASE
              WHEN item.item_type = 'COURSE' THEN EXISTS (
                SELECT 1
                  FROM platform.learning_enrollments course_enrollment
                 WHERE course_enrollment.tenant_id = item.tenant_id
                   AND course_enrollment.learner_id = $3::uuid
                   AND course_enrollment.course_version_id = item.course_version_id
                   AND course_enrollment.status = 'COMPLETED'
              )
              WHEN item.item_type = 'ASSESSMENT' THEN EXISTS (
                SELECT 1
                  FROM platform.learning_assessment_attempts attempt
                 WHERE attempt.tenant_id = item.tenant_id
                   AND attempt.learner_id = $3::uuid
                   AND attempt.assessment_version_id = item.assessment_version_id
                   AND attempt.status = 'GRADED'
                   AND attempt.passed = true
              )
              ELSE false
            END AS completed
       FROM platform.learning_program_items item
      WHERE item.tenant_id = $1::uuid
        AND item.program_version_id = $2::uuid
      ORDER BY item.position`,
    [input.tenantId, current.program_version_id, current.learner_id],
  );

  const required = items.rows.filter((item) => item.required);
  if (required.length === 0) throw new Error('LEARNING_PROGRAM_REQUIRED_ITEMS_MISSING');
  const completedRequired = required.filter((item) => item.completed).length;
  const percent = Math.round((completedRequired / required.length) * 10000) / 100;
  const complete = completedRequired === required.length;
  const now = new Date();
  const newlyCompleted = complete && current.status !== 'COMPLETED';
  const nextStatus: LearningProgramEnrollmentStatus = complete
    ? 'COMPLETED'
    : completedRequired > 0
      ? 'IN_PROGRESS'
      : 'ASSIGNED';

  await client.query(
    `UPDATE platform.learning_program_enrollments
        SET status = $3,
            completion_percent = $4,
            started_at = CASE
              WHEN $3 IN ('IN_PROGRESS','COMPLETED') THEN COALESCE(started_at, $5)
              ELSE started_at
            END,
            completed_at = CASE
              WHEN $3 = 'COMPLETED' THEN COALESCE(completed_at, $5)
              ELSE completed_at
            END,
            last_reconciled_at = $5,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND program_enrollment_id = $2::uuid`,
    [input.tenantId, input.programEnrollmentId, nextStatus, percent, now],
  );

  if (newlyCompleted) {
    await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'learning.program_enrollment',
        aggregateId: input.programEnrollmentId,
        eventType: 'learning.program.completed',
        eventVersion: 1,
        occurredAt: now,
        actorSubjectId: input.actorSubjectId,
        correlationId: input.correlationId,
        payload: {
          learnerId: current.learner_id,
          programId: current.program_id,
          programVersionId: current.program_version_id,
          programVersion: current.program_version,
          completionPercent: 100,
        },
        metadata: { source: 'learning.program.reconciliation' },
      },
    });
  }

  const issuedCredentials = complete
    ? await issueEligibleCredentials(client, {
      tenantId: input.tenantId,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      programEnrollmentId: input.programEnrollmentId,
      learnerId: current.learner_id,
      programVersionId: current.program_version_id,
      issuedAt: now,
    })
    : [];

  const refreshed = await loadProgramEnrollment(
    client,
    input.tenantId,
    input.programEnrollmentId,
  );
  if (refreshed === null) throw new Error('LEARNING_PROGRAM_ENROLLMENT_NOT_FOUND');

  return {
    enrollment: refreshed,
    requirements: items.rows.map((item) => ({
      type: item.item_type,
      position: item.position,
      required: item.required,
      courseVersionId: item.course_version_id,
      assessmentVersionId: item.assessment_version_id,
      completed: item.completed,
    })),
    newlyCompleted,
    issuedCredentials,
  };
}

export async function reconcileLearningProgramsForEvidence(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly courseVersionId?: string;
    readonly assessmentVersionId?: string;
  },
): Promise<readonly LearningProgramReconciliation[]> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.learnerId, 'learner_id');
  const courseVersionId = input.courseVersionId === undefined
    ? null
    : stableUuid(input.courseVersionId, 'course_version_id');
  const assessmentVersionId = input.assessmentVersionId === undefined
    ? null
    : stableUuid(input.assessmentVersionId, 'assessment_version_id');
  if (courseVersionId === null && assessmentVersionId === null) {
    throw new Error('LEARNING_PROGRAM_EVIDENCE_REQUIRED');
  }

  const affected = await client.query<{ readonly program_enrollment_id: string }>(
    `SELECT DISTINCT enrollment.program_enrollment_id
       FROM platform.learning_program_enrollments enrollment
       JOIN platform.learning_program_items item
         ON item.program_version_id = enrollment.program_version_id
        AND item.tenant_id = enrollment.tenant_id
      WHERE enrollment.tenant_id = $1::uuid
        AND enrollment.learner_id = $2::uuid
        AND enrollment.status <> 'CANCELLED'
        AND (
          ($3::uuid IS NOT NULL AND item.course_version_id = $3::uuid)
          OR
          ($4::uuid IS NOT NULL AND item.assessment_version_id = $4::uuid)
        )
      ORDER BY enrollment.program_enrollment_id`,
    [input.tenantId, input.learnerId, courseVersionId, assessmentVersionId],
  );

  const reconciled: LearningProgramReconciliation[] = [];
  for (const row of affected.rows) {
    reconciled.push(await reconcileLearningProgramEnrollment(client, {
      tenantId: input.tenantId,
      programEnrollmentId: row.program_enrollment_id,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      expectedLearnerId: input.learnerId,
    }));
  }
  return reconciled;
}

async function issueEligibleCredentials(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly programEnrollmentId: string;
    readonly learnerId: string;
    readonly programVersionId: string;
    readonly issuedAt: Date;
  },
): Promise<readonly LearningCredentialSummary[]> {
  const certifications = await client.query<CertificationVersionRow>(
    `SELECT version.certification_version_id, version.certification_id,
            version.version, version.state, version.title, version.description,
            version.program_version_id, version.validity_days,
            version.renewal_window_days
       FROM platform.learning_certification_versions version
       JOIN platform.learning_certifications certification
         ON certification.certification_id = version.certification_id
        AND certification.tenant_id = version.tenant_id
        AND certification.status = 'ACTIVE'
      WHERE version.tenant_id = $1::uuid
        AND version.program_version_id = $2::uuid
        AND version.state = 'PUBLISHED'`,
    [input.tenantId, input.programVersionId],
  );

  const issued: LearningCredentialSummary[] = [];

  for (const version of certifications.rows) {
    const existing = await loadCredentialByLearnerCertification(
      client,
      input.tenantId,
      input.learnerId,
      version.certification_version_id,
    );
    if (existing !== null) {
      issued.push(existing);
      continue;
    }

    const expiresAt = version.validity_days === null
      ? null
      : new Date(input.issuedAt.getTime() + version.validity_days * 86400000);
    const renewalDueAt =
      expiresAt === null || version.renewal_window_days === null
        ? null
        : new Date(expiresAt.getTime() - version.renewal_window_days * 86400000);

    let created = false;
    try {
      const result = await client.query<{ readonly credential_id: string }>(
        `INSERT INTO platform.learning_credentials (
           tenant_id, credential_key, certification_id,
           certification_version_id, program_enrollment_id, learner_id,
           program_version_id, status, issued_by_subject_id, issued_at,
           renewal_due_at, expires_at
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
           $7::uuid, 'ACTIVE', $8, $9, $10, $11
         )
         ON CONFLICT (tenant_id, learner_id, certification_version_id)
         DO NOTHING
         RETURNING credential_id`,
        [
          input.tenantId,
          randomUUID(),
          version.certification_id,
          version.certification_version_id,
          input.programEnrollmentId,
          input.learnerId,
          input.programVersionId,
          input.actorSubjectId,
          input.issuedAt,
          renewalDueAt,
          expiresAt,
        ],
      );
      created = result.rows[0] !== undefined;
    } catch (error) {
      throw error;
    }

    const loaded = await loadCredentialByLearnerCertification(
      client,
      input.tenantId,
      input.learnerId,
      version.certification_version_id,
    );
    if (loaded === null) throw new Error('LEARNING_CREDENTIAL_INSERT_FAILED');

    if (created) {
      await appendDomainEventWithOutbox(client, {
        event: {
          eventId: randomUUID(),
          tenantId: input.tenantId,
          aggregateType: 'learning.credential',
          aggregateId: loaded.credentialId,
          eventType: 'learning.credential.issued',
          eventVersion: 1,
          occurredAt: input.issuedAt,
          actorSubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          payload: {
            credentialKey: loaded.credentialKey,
            certificationId: loaded.certificationId,
            certificationVersionId: loaded.certificationVersionId,
            certificationVersion: loaded.certificationVersion,
            programEnrollmentId: loaded.programEnrollmentId,
            programVersionId: loaded.programVersionId,
            learnerId: loaded.learnerId,
            expiresAt: loaded.expiresAt,
            renewalDueAt: loaded.renewalDueAt,
          },
          metadata: { source: 'learning.credential.issuance' },
        },
      });
    }

    issued.push(loaded);
  }

  return issued;
}

export async function reconcileMyLearningProgramEnrollment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly programEnrollmentId: string;
    readonly correlationId: string;
  },
): Promise<LearningProgramReconciliation> {
  await requireLearning(client, input.tenantId);
  const learnerId = await resolveActiveLearnerId(client, input);
  return reconcileLearningProgramEnrollment(client, {
    tenantId: input.tenantId,
    programEnrollmentId: input.programEnrollmentId,
    actorSubjectId: input.subjectId,
    correlationId: input.correlationId,
    expectedLearnerId: learnerId,
  });
}

export async function listMyLearningCredentials(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
  },
): Promise<readonly LearningCredentialSummary[]> {
  await requireLearning(client, input.tenantId);
  const learnerId = await resolveActiveLearnerId(client, input);
  return listLearningCredentials(client, {
    tenantId: input.tenantId,
    learnerId,
  });
}

export async function listLearningCredentials(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId?: string;
  },
): Promise<readonly LearningCredentialSummary[]> {
  await requireLearning(client, input.tenantId);
  const result = await client.query<CredentialRow>(
    credentialSelectSql() +
      `
      WHERE credential.tenant_id = $1::uuid
        AND ($2::uuid IS NULL OR credential.learner_id = $2::uuid)
      ORDER BY credential.issued_at DESC, credential.credential_id`,
    [input.tenantId, input.learnerId ?? null],
  );
  return result.rows.map((row) => credential(row));
}

export async function reconcileLearningCredentialStatuses(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId?: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly now?: Date;
  },
): Promise<readonly LearningCredentialSummary[]> {
  await requireLearning(client, input.tenantId);
  const now = input.now ?? new Date();
  const current = await listLearningCredentials(client, {
    tenantId: input.tenantId,
    ...(input.learnerId === undefined ? {} : { learnerId: input.learnerId }),
  });

  for (const item of current) {
    if (item.status === 'REVOKED') continue;
    const next = credentialStatusAt({
      currentStatus: item.status,
      expiresAt: item.expiresAt,
      renewalDueAt: item.renewalDueAt,
    }, now);
    if (next === item.status) continue;

    await client.query(
      `UPDATE platform.learning_credentials
          SET status = $3,
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND credential_id = $2::uuid
          AND status <> 'REVOKED'`,
      [input.tenantId, item.credentialId, next],
    );

    if (next === 'EXPIRING' || next === 'EXPIRED') {
      await appendDomainEventWithOutbox(client, {
        event: {
          eventId: randomUUID(),
          tenantId: input.tenantId,
          aggregateType: 'learning.credential',
          aggregateId: item.credentialId,
          eventType:
            next === 'EXPIRING'
              ? 'learning.credential.expiring'
              : 'learning.credential.expired',
          eventVersion: 1,
          occurredAt: now,
          actorSubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          payload: {
            credentialKey: item.credentialKey,
            learnerId: item.learnerId,
            certificationId: item.certificationId,
            certificationVersionId: item.certificationVersionId,
            renewalDueAt: item.renewalDueAt,
            expiresAt: item.expiresAt,
          },
          metadata: { source: 'learning.credential.lifecycle' },
        },
      });
    }
  }

  return listLearningCredentials(client, {
    tenantId: input.tenantId,
    ...(input.learnerId === undefined ? {} : { learnerId: input.learnerId }),
  });
}

export async function reconcileMyLearningCredentialStatuses(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly correlationId: string;
    readonly now?: Date;
  },
): Promise<readonly LearningCredentialSummary[]> {
  await requireLearning(client, input.tenantId);
  const learnerId = await resolveActiveLearnerId(client, input);
  return reconcileLearningCredentialStatuses(client, {
    tenantId: input.tenantId,
    learnerId,
    actorSubjectId: input.subjectId,
    correlationId: input.correlationId,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function revokeLearningCredential(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly credentialId: string;
    readonly actorSubjectId: string;
    readonly reason: string;
    readonly correlationId: string;
  },
): Promise<{ readonly credential: LearningCredentialSummary; readonly idempotent: boolean }> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.credentialId, 'credential_id');
  const reason = input.reason.trim();
  if (reason === '' || reason.length > 2000) {
    throw new Error('LEARNING_CREDENTIAL_REVOCATION_REASON_INVALID');
  }

  const locked = await client.query<CredentialRow>(
    credentialSelectSql() +
      `
      WHERE credential.tenant_id = $1::uuid
        AND credential.credential_id = $2::uuid
      FOR UPDATE OF credential`,
    [input.tenantId, input.credentialId],
  );
  const current = locked.rows[0];
  if (current === undefined) throw new Error('LEARNING_CREDENTIAL_NOT_FOUND');
  if (current.status === 'REVOKED') {
    return { credential: credential(current), idempotent: true };
  }

  const now = new Date();
  await client.query(
    `UPDATE platform.learning_credentials
        SET status = 'REVOKED',
            revoked_at = $3,
            revoked_by_subject_id = $4,
            revocation_reason = $5,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND credential_id = $2::uuid`,
    [input.tenantId, input.credentialId, now, input.actorSubjectId, reason],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.credential',
      aggregateId: input.credentialId,
      eventType: 'learning.credential.revoked',
      eventVersion: 1,
      occurredAt: now,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        credentialKey: current.credential_key,
        learnerId: current.learner_id,
        certificationId: current.certification_id,
        certificationVersionId: current.certification_version_id,
        reason,
      },
      metadata: { source: 'learning.credential.revocation' },
    },
  });

  const refreshed = await loadCredential(client, input.tenantId, input.credentialId);
  if (refreshed === null) throw new Error('LEARNING_CREDENTIAL_NOT_FOUND');
  return { credential: refreshed, idempotent: false };
}

async function resolveActiveLearnerId(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
  },
): Promise<string> {
  const result = await client.query<{ readonly learner_id: string }>(
    `SELECT learner_id
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
        AND subject_id = $2
        AND subject_issuer IS NOT DISTINCT FROM $3
        AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.subjectId, input.subjectIssuer],
  );
  const learnerId = result.rows[0]?.learner_id;
  if (learnerId === undefined) throw new Error('LEARNING_LEARNER_NOT_FOUND');
  return learnerId;
}

async function loadProgramEnrollmentByAssignmentKey(
  client: PostgresClient,
  tenantId: string,
  assignmentKey: string,
): Promise<LearningProgramEnrollmentSummary | null> {
  const result = await client.query<ProgramEnrollmentListRow>(
    `SELECT enrollment.*, learner.full_name AS learner_name,
            program.program_key, version.version AS program_version,
            version.title AS program_title
       FROM platform.learning_program_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id = enrollment.learner_id
        AND learner.tenant_id = enrollment.tenant_id
       JOIN platform.learning_programs program
         ON program.program_id = enrollment.program_id
        AND program.tenant_id = enrollment.tenant_id
       JOIN platform.learning_program_versions version
         ON version.program_version_id = enrollment.program_version_id
        AND version.tenant_id = enrollment.tenant_id
      WHERE enrollment.tenant_id = $1::uuid
        AND enrollment.assignment_key = $2
      LIMIT 1`,
    [tenantId, assignmentKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : enrollment(row);
}

async function loadProgramEnrollment(
  client: PostgresClient,
  tenantId: string,
  programEnrollmentId: string,
): Promise<LearningProgramEnrollmentSummary | null> {
  const result = await client.query<ProgramEnrollmentListRow>(
    `SELECT enrollment.*, learner.full_name AS learner_name,
            program.program_key, version.version AS program_version,
            version.title AS program_title
       FROM platform.learning_program_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id = enrollment.learner_id
        AND learner.tenant_id = enrollment.tenant_id
       JOIN platform.learning_programs program
         ON program.program_id = enrollment.program_id
        AND program.tenant_id = enrollment.tenant_id
       JOIN platform.learning_program_versions version
         ON version.program_version_id = enrollment.program_version_id
        AND version.tenant_id = enrollment.tenant_id
      WHERE enrollment.tenant_id = $1::uuid
        AND enrollment.program_enrollment_id = $2::uuid
      LIMIT 1`,
    [tenantId, programEnrollmentId],
  );
  const row = result.rows[0];
  return row === undefined ? null : enrollment(row);
}

function credentialSelectSql(): string {
  return `SELECT credential.credential_id, credential.credential_key,
            credential.certification_id, credential.certification_version_id,
            version.version AS certification_version,
            certification.certification_key,
            version.title AS certification_title,
            credential.program_enrollment_id, credential.learner_id,
            credential.program_version_id, credential.status,
            credential.issued_at, credential.renewal_due_at,
            credential.expires_at, credential.revoked_at,
            credential.revocation_reason
       FROM platform.learning_credentials credential
       JOIN platform.learning_certifications certification
         ON certification.certification_id = credential.certification_id
        AND certification.tenant_id = credential.tenant_id
       JOIN platform.learning_certification_versions version
         ON version.certification_version_id = credential.certification_version_id
        AND version.tenant_id = credential.tenant_id`;
}

async function loadCredentialByLearnerCertification(
  client: PostgresClient,
  tenantId: string,
  learnerId: string,
  certificationVersionId: string,
): Promise<LearningCredentialSummary | null> {
  const result = await client.query<CredentialRow>(
    credentialSelectSql() +
      `
      WHERE credential.tenant_id = $1::uuid
        AND credential.learner_id = $2::uuid
        AND credential.certification_version_id = $3::uuid
      LIMIT 1`,
    [tenantId, learnerId, certificationVersionId],
  );
  const row = result.rows[0];
  return row === undefined ? null : credential(row);
}

async function loadCredential(
  client: PostgresClient,
  tenantId: string,
  credentialId: string,
): Promise<LearningCredentialSummary | null> {
  const result = await client.query<CredentialRow>(
    credentialSelectSql() +
      `
      WHERE credential.tenant_id = $1::uuid
        AND credential.credential_id = $2::uuid
      LIMIT 1`,
    [tenantId, credentialId],
  );
  const row = result.rows[0];
  return row === undefined ? null : credential(row);
}
