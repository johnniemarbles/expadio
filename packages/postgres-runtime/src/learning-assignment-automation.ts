import { randomUUID } from 'node:crypto';
import {
  matchesLearningAssignmentRule,
  validateLearningAssignmentRuleDraft,
  type LearnerAudienceType,
  type LearningAssignmentConditions,
  type LearningAssignmentTargetType,
} from '@expadio/learning';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import {
  createLearningEnrollment,
} from './learning-enrollment.ts';
import {
  createLearningProgramEnrollment,
} from './learning-program-certification.ts';
import { requireTenantModuleOperational } from './product-module.ts';

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RuleVersionRow {
  readonly assignment_rule_version_id: string;
  readonly assignment_rule_id: string;
  readonly rule_key: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly name: string;
  readonly description: string;
  readonly target_type: LearningAssignmentTargetType;
  readonly course_id: string | null;
  readonly program_id: string | null;
  readonly due_days: number | null;
  readonly conditions: LearningAssignmentConditions;
}

interface LearnerRow {
  readonly learner_id: string;
  readonly subject_id: string | null;
  readonly audience_type: LearnerAudienceType;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  readonly metadata: Record<string, unknown>;
}

interface ExecutionRow {
  readonly assignment_rule_execution_id: string;
  readonly assignment_rule_version_id: string;
  readonly learner_id: string;
  readonly trigger_event_id: string | null;
  readonly evaluated_by_subject_id: string;
  readonly correlation_id: string;
  readonly outcome: 'NOT_MATCHED' | 'ASSIGNED' | 'SATISFIED';
  readonly target_type: LearningAssignmentTargetType;
  readonly enrollment_id: string | null;
  readonly program_enrollment_id: string | null;
  readonly evaluated_at: Date | string;
}

export interface LearningAssignmentRuleSummary {
  readonly assignmentRuleId: string;
  readonly ruleKey: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly currentPublishedVersion: number | null;
  readonly publishedName: string | null;
  readonly targetType: LearningAssignmentTargetType | null;
}

export interface LearningAssignmentExecutionResult {
  readonly assignmentRuleExecutionId: string;
  readonly assignmentRuleId: string;
  readonly assignmentRuleVersionId: string;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly learnerId: string;
  readonly outcome: 'NOT_MATCHED' | 'ASSIGNED' | 'SATISFIED';
  readonly targetType: LearningAssignmentTargetType;
  readonly enrollmentId: string | null;
  readonly programEnrollmentId: string | null;
  readonly triggerEventId: string | null;
  readonly evaluatedAt: string;
  readonly idempotent: boolean;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stableKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('LEARNING_ASSIGNMENT_RULE_KEY_REQUIRED');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 160 || !KEY.test(normalized)) {
    throw new Error('LEARNING_ASSIGNMENT_RULE_KEY_INVALID');
  }
  return normalized;
}

function stableUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw new Error(`LEARNING_${field.toUpperCase()}_INVALID`);
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

export async function createLearningAssignmentRule(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly ruleKey: unknown;
    readonly draft: unknown;
  },
): Promise<{
  readonly assignmentRuleId: string;
  readonly ruleKey: string;
  readonly assignmentRuleVersionId: string;
  readonly version: 1;
  readonly state: 'DRAFT';
}> {
  await requireLearning(client, input.tenantId);
  const ruleKey = stableKey(input.ruleKey);
  const draft = validateLearningAssignmentRuleDraft(input.draft);
  const academyId = await defaultAcademyId(client, input.tenantId);

  if (draft.targetType === 'COURSE') {
    const target = await client.query(
      `SELECT 1
         FROM platform.learning_courses
        WHERE tenant_id = $1::uuid
          AND course_id = $2::uuid
          AND status = 'ACTIVE'`,
      [input.tenantId, draft.courseId],
    );
    if (target.rows[0] === undefined) {
      throw new Error('LEARNING_ASSIGNMENT_RULE_COURSE_NOT_FOUND');
    }
  } else {
    const target = await client.query(
      `SELECT 1
         FROM platform.learning_programs
        WHERE tenant_id = $1::uuid
          AND program_id = $2::uuid
          AND status = 'ACTIVE'`,
      [input.tenantId, draft.programId],
    );
    if (target.rows[0] === undefined) {
      throw new Error('LEARNING_ASSIGNMENT_RULE_PROGRAM_NOT_FOUND');
    }
  }

  try {
    const ruleResult = await client.query<{ readonly assignment_rule_id: string }>(
      `INSERT INTO platform.learning_assignment_rules (
         tenant_id, academy_id, rule_key, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING assignment_rule_id`,
      [input.tenantId, academyId, ruleKey, input.actorSubjectId],
    );
    const assignmentRuleId = ruleResult.rows[0]?.assignment_rule_id;
    if (assignmentRuleId === undefined) {
      throw new Error('LEARNING_ASSIGNMENT_RULE_INSERT_FAILED');
    }

    const versionResult = await client.query<{
      readonly assignment_rule_version_id: string;
    }>(
      `INSERT INTO platform.learning_assignment_rule_versions (
         tenant_id, assignment_rule_id, version, state, name, description,
         target_type, course_id, program_id, due_days, conditions,
         created_by_subject_id, updated_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', $3, $4,
         $5, $6::uuid, $7::uuid, $8, $9::jsonb, $10, $10
       )
       RETURNING assignment_rule_version_id`,
      [
        input.tenantId,
        assignmentRuleId,
        draft.name,
        draft.description,
        draft.targetType,
        draft.courseId,
        draft.programId,
        draft.dueDays,
        JSON.stringify(draft.conditions),
        input.actorSubjectId,
      ],
    );
    const assignmentRuleVersionId =
      versionResult.rows[0]?.assignment_rule_version_id;
    if (assignmentRuleVersionId === undefined) {
      throw new Error('LEARNING_ASSIGNMENT_RULE_VERSION_INSERT_FAILED');
    }

    return {
      assignmentRuleId,
      ruleKey,
      assignmentRuleVersionId,
      version: 1,
      state: 'DRAFT',
    };
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new Error('LEARNING_ASSIGNMENT_RULE_KEY_EXISTS');
    }
    throw error;
  }
}

export interface LearningAssignmentRulePreview {
  readonly totalLearners: number;
  readonly matchedLearners: number;
  readonly unmatchedLearners: number;
  readonly sample: readonly {
    readonly learnerId: string;
    readonly fullName: string;
    readonly audienceType: LearnerAudienceType;
    readonly subjectLinked: boolean;
  }[];
}

export async function previewLearningAssignmentRule(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly draft: unknown;
    readonly sampleLimit?: number;
  },
): Promise<LearningAssignmentRulePreview> {
  await requireLearning(client, input.tenantId);
  const draft = validateLearningAssignmentRuleDraft(input.draft);
  const target = draft.targetType === 'COURSE'
    ? await client.query(
        `SELECT 1 FROM platform.learning_courses
          WHERE tenant_id=$1::uuid AND course_id=$2::uuid
            AND status='ACTIVE' AND current_published_version IS NOT NULL`,
        [input.tenantId, draft.courseId],
      )
    : await client.query(
        `SELECT 1 FROM platform.learning_programs
          WHERE tenant_id=$1::uuid AND program_id=$2::uuid
            AND status='ACTIVE' AND current_published_version IS NOT NULL`,
        [input.tenantId, draft.programId],
      );
  if (target.rows[0] === undefined) throw new Error('LEARNING_ASSIGNMENT_RULE_PREVIEW_TARGET_NOT_AVAILABLE');

  const sampleLimit = Math.min(100, Math.max(1, input.sampleLimit ?? 25));
  const result = await client.query<LearnerRow & { readonly full_name: string }>(
    `SELECT learner_id, subject_id, audience_type, status, metadata, full_name
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid AND status = 'ACTIVE'
      ORDER BY full_name, learner_id`,
    [input.tenantId],
  );
  const matches = result.rows.filter((learner) => matchesLearningAssignmentRule(
    draft.conditions,
    {
      audienceType: learner.audience_type,
      subjectId: learner.subject_id,
      metadata: learner.metadata,
    },
  ));
  return {
    totalLearners: result.rows.length,
    matchedLearners: matches.length,
    unmatchedLearners: result.rows.length - matches.length,
    sample: matches.slice(0, sampleLimit).map((learner) => ({
      learnerId: learner.learner_id,
      fullName: learner.full_name,
      audienceType: learner.audience_type,
      subjectLinked: learner.subject_id !== null,
    })),
  };
}

export async function listLearningAssignmentRules(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningAssignmentRuleSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly assignment_rule_id: string;
    readonly rule_key: string;
    readonly status: 'ACTIVE' | 'ARCHIVED';
    readonly current_published_version: number | null;
    readonly published_name: string | null;
    readonly target_type: LearningAssignmentTargetType | null;
  }>(
    `SELECT rule.assignment_rule_id, rule.rule_key, rule.status,
            rule.current_published_version,
            version.name AS published_name,
            version.target_type
       FROM platform.learning_assignment_rules rule
       LEFT JOIN platform.learning_assignment_rule_versions version
         ON version.assignment_rule_id = rule.assignment_rule_id
        AND version.tenant_id = rule.tenant_id
        AND version.state = 'PUBLISHED'
      WHERE rule.tenant_id = $1::uuid
      ORDER BY rule.updated_at DESC, rule.rule_key`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    assignmentRuleId: row.assignment_rule_id,
    ruleKey: row.rule_key,
    status: row.status,
    currentPublishedVersion: row.current_published_version,
    publishedName: row.published_name,
    targetType: row.target_type,
  }));
}

export async function publishLearningAssignmentRuleVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly assignmentRuleId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly assignmentRuleVersionId: string;
  readonly version: number;
  readonly idempotent: boolean;
}> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.assignmentRuleId, 'assignment_rule_id');

  const rule = await client.query(
    `SELECT 1
       FROM platform.learning_assignment_rules
      WHERE tenant_id = $1::uuid
        AND assignment_rule_id = $2::uuid
        AND status = 'ACTIVE'
      FOR UPDATE`,
    [input.tenantId, input.assignmentRuleId],
  );
  if (rule.rows[0] === undefined) {
    throw new Error('LEARNING_ASSIGNMENT_RULE_NOT_FOUND');
  }

  const versions = await client.query<RuleVersionRow>(
    `SELECT version.assignment_rule_version_id,
            version.assignment_rule_id, rule.rule_key,
            version.version, version.state, version.name,
            version.description, version.target_type, version.course_id,
            version.program_id, version.due_days, version.conditions
       FROM platform.learning_assignment_rule_versions version
       JOIN platform.learning_assignment_rules rule
         ON rule.assignment_rule_id = version.assignment_rule_id
        AND rule.tenant_id = version.tenant_id
      WHERE version.tenant_id = $1::uuid
        AND version.assignment_rule_id = $2::uuid
        AND version.version = $3
      FOR UPDATE OF version`,
    [input.tenantId, input.assignmentRuleId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) {
    throw new Error('LEARNING_ASSIGNMENT_RULE_VERSION_NOT_FOUND');
  }
  if (target.state === 'PUBLISHED') {
    return {
      assignmentRuleVersionId: target.assignment_rule_version_id,
      version: target.version,
      idempotent: true,
    };
  }
  if (target.state !== 'DRAFT') {
    throw new Error('LEARNING_ASSIGNMENT_RULE_VERSION_NOT_PUBLISHABLE');
  }

  await client.query(
    `UPDATE platform.learning_assignment_rule_versions
        SET state = 'SUPERSEDED',
            updated_by_subject_id = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND assignment_rule_id = $2::uuid
        AND state = 'PUBLISHED'
        AND version <> $4`,
    [
      input.tenantId,
      input.assignmentRuleId,
      input.actorSubjectId,
      input.version,
    ],
  );

  await client.query(
    `UPDATE platform.learning_assignment_rule_versions
        SET state = 'PUBLISHED',
            published_by_subject_id = $4,
            published_at = now(),
            updated_by_subject_id = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND assignment_rule_id = $2::uuid
        AND version = $3`,
    [
      input.tenantId,
      input.assignmentRuleId,
      input.version,
      input.actorSubjectId,
    ],
  );

  await client.query(
    `UPDATE platform.learning_assignment_rules
        SET current_published_version = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND assignment_rule_id = $2::uuid`,
    [input.tenantId, input.assignmentRuleId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.assignment_rule',
      aggregateId: input.assignmentRuleId,
      eventType: 'learning.assignment.rule.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        assignmentRuleVersionId: target.assignment_rule_version_id,
        version: target.version,
        targetType: target.target_type,
      },
      metadata: { source: 'learning.assignment.automation' },
    },
  });

  return {
    assignmentRuleVersionId: target.assignment_rule_version_id,
    version: target.version,
    idempotent: false,
  };
}

export interface LearningAssignmentExecutionSummary {
  readonly assignmentRuleExecutionId: string;
  readonly assignmentRuleId: string;
  readonly assignmentRuleVersionId: string;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly ruleName: string;
  readonly learnerId: string;
  readonly learnerName: string;
  readonly outcome: 'NOT_MATCHED' | 'ASSIGNED' | 'SATISFIED';
  readonly targetType: LearningAssignmentTargetType;
  readonly enrollmentId: string | null;
  readonly programEnrollmentId: string | null;
  readonly triggerEventId: string | null;
  readonly correlationId: string;
  readonly evaluatedAt: string;
}

export async function listLearningAssignmentRuleExecutions(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly learnerId?: string; readonly limit?: number },
): Promise<readonly LearningAssignmentExecutionSummary[]> {
  await requireLearning(client, input.tenantId);
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const result = await client.query<{
    readonly assignment_rule_execution_id: string;
    readonly assignment_rule_id: string;
    readonly assignment_rule_version_id: string;
    readonly rule_key: string;
    readonly rule_version: number;
    readonly rule_name: string;
    readonly learner_id: string;
    readonly learner_name: string;
    readonly outcome: LearningAssignmentExecutionSummary['outcome'];
    readonly target_type: LearningAssignmentTargetType;
    readonly enrollment_id: string | null;
    readonly program_enrollment_id: string | null;
    readonly trigger_event_id: string | null;
    readonly correlation_id: string;
    readonly evaluated_at: Date | string;
  }>(
    `SELECT execution.assignment_rule_execution_id,
            version.assignment_rule_id, execution.assignment_rule_version_id,
            rule.rule_key, version.version AS rule_version, version.name AS rule_name,
            execution.learner_id, learner.full_name AS learner_name,
            execution.outcome, execution.target_type, execution.enrollment_id,
            execution.program_enrollment_id, execution.trigger_event_id,
            execution.correlation_id, execution.evaluated_at
       FROM platform.learning_assignment_rule_executions execution
       JOIN platform.learning_assignment_rule_versions version
         ON version.assignment_rule_version_id=execution.assignment_rule_version_id
        AND version.tenant_id=execution.tenant_id
       JOIN platform.learning_assignment_rules rule
         ON rule.assignment_rule_id=version.assignment_rule_id
        AND rule.tenant_id=execution.tenant_id
       JOIN platform.learning_learners learner
         ON learner.learner_id=execution.learner_id
        AND learner.tenant_id=execution.tenant_id
      WHERE execution.tenant_id=$1::uuid
        AND ($3::uuid IS NULL OR execution.learner_id = $3::uuid)
      ORDER BY execution.evaluated_at DESC, execution.assignment_rule_execution_id DESC
      LIMIT $2`,
    [input.tenantId, limit, input.learnerId ?? null],
  );
  return result.rows.map((row) => ({
    assignmentRuleExecutionId: row.assignment_rule_execution_id,
    assignmentRuleId: row.assignment_rule_id,
    assignmentRuleVersionId: row.assignment_rule_version_id,
    ruleKey: row.rule_key,
    ruleVersion: row.rule_version,
    ruleName: row.rule_name,
    learnerId: row.learner_id,
    learnerName: row.learner_name,
    outcome: row.outcome,
    targetType: row.target_type,
    enrollmentId: row.enrollment_id,
    programEnrollmentId: row.program_enrollment_id,
    triggerEventId: row.trigger_event_id,
    correlationId: row.correlation_id,
    evaluatedAt: iso(row.evaluated_at),
  }));
}

export async function evaluateLearningAssignmentRulesForLearner(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly triggerEventId?: string;
    readonly evaluatedAt?: Date;
  },
): Promise<readonly LearningAssignmentExecutionResult[]> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.learnerId, 'learner_id');
  if (input.triggerEventId !== undefined) {
    stableUuid(input.triggerEventId, 'trigger_event_id');
  }
  const evaluatedAt = input.evaluatedAt ?? new Date();

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`learning-assignment:${input.tenantId}:${input.learnerId}`],
  );

  const learnerResult = await client.query<LearnerRow>(
    `SELECT learner_id, subject_id, audience_type, status, metadata
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
        AND learner_id = $2::uuid`,
    [input.tenantId, input.learnerId],
  );
  const learner = learnerResult.rows[0];
  if (learner === undefined) throw new Error('LEARNING_LEARNER_NOT_FOUND');
  if (learner.status !== 'ACTIVE') throw new Error('LEARNING_LEARNER_NOT_ACTIVE');

  const rules = await client.query<RuleVersionRow>(
    `SELECT version.assignment_rule_version_id,
            version.assignment_rule_id, rule.rule_key,
            version.version, version.state, version.name,
            version.description, version.target_type, version.course_id,
            version.program_id, version.due_days, version.conditions
       FROM platform.learning_assignment_rules rule
       JOIN platform.learning_assignment_rule_versions version
         ON version.assignment_rule_id = rule.assignment_rule_id
        AND version.tenant_id = rule.tenant_id
        AND version.state = 'PUBLISHED'
      WHERE rule.tenant_id = $1::uuid
        AND rule.status = 'ACTIVE'
      ORDER BY rule.rule_key, version.version`,
    [input.tenantId],
  );

  const existing = await client.query<ExecutionRow>(
    `SELECT assignment_rule_execution_id, assignment_rule_version_id,
            learner_id, trigger_event_id, evaluated_by_subject_id,
            correlation_id, outcome, target_type, enrollment_id,
            program_enrollment_id, evaluated_at
       FROM platform.learning_assignment_rule_executions
      WHERE tenant_id = $1::uuid
        AND learner_id = $2::uuid`,
    [input.tenantId, input.learnerId],
  );
  const existingByRule = new Map(
    existing.rows.map((row) => [row.assignment_rule_version_id, row]),
  );

  const results: LearningAssignmentExecutionResult[] = [];

  for (const rule of rules.rows) {
    const replay = existingByRule.get(rule.assignment_rule_version_id);
    if (replay !== undefined) {
      results.push(result(rule, replay, true));
      continue;
    }

    const matched = matchesLearningAssignmentRule(rule.conditions, {
      audienceType: learner.audience_type,
      subjectId: learner.subject_id,
      metadata: learner.metadata,
    });

    if (!matched) {
      const execution = await persistExecution(client, {
        tenantId: input.tenantId,
        rule,
        learnerId: input.learnerId,
        triggerEventId: input.triggerEventId ?? null,
        actorSubjectId: input.actorSubjectId,
        correlationId: input.correlationId,
        outcome: 'NOT_MATCHED',
        enrollmentId: null,
        programEnrollmentId: null,
        evaluatedAt,
      });
      results.push(result(rule, execution, false));
      continue;
    }

    if (rule.target_type === 'COURSE') {
      const current = await client.query<{ readonly course_version_id: string }>(
        `SELECT version.course_version_id
           FROM platform.learning_courses course
           JOIN platform.learning_course_versions version
             ON version.course_id = course.course_id
            AND version.tenant_id = course.tenant_id
            AND version.version = course.current_published_version
            AND version.state = 'PUBLISHED'
          WHERE course.tenant_id = $1::uuid
            AND course.course_id = $2::uuid
            AND course.status = 'ACTIVE'`,
        [input.tenantId, rule.course_id],
      );
      const courseVersionId = current.rows[0]?.course_version_id;
      if (courseVersionId === undefined) {
        throw new Error('LEARNING_ASSIGNMENT_RULE_TARGET_NOT_PUBLISHED');
      }

      const satisfied = await client.query<{ readonly enrollment_id: string }>(
        `SELECT enrollment_id
           FROM platform.learning_enrollments
          WHERE tenant_id = $1::uuid
            AND learner_id = $2::uuid
            AND course_version_id = $3::uuid
            AND status IN ('ASSIGNED','IN_PROGRESS','COMPLETED')
          ORDER BY assigned_at DESC, enrollment_id
          LIMIT 1`,
        [input.tenantId, input.learnerId, courseVersionId],
      );
      const existingEnrollmentId = satisfied.rows[0]?.enrollment_id ?? null;

      let enrollmentId = existingEnrollmentId;
      let outcome: 'ASSIGNED' | 'SATISFIED' =
        existingEnrollmentId === null ? 'ASSIGNED' : 'SATISFIED';

      if (enrollmentId === null) {
        const dueAt =
          rule.due_days === null
            ? null
            : new Date(
                evaluatedAt.getTime() + rule.due_days * 86_400_000,
              ).toISOString();
        const assigned = await createLearningEnrollment(client, {
          tenantId: input.tenantId,
          actorSubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          enrollment: {
            assignmentKey: assignmentKey(rule, input.learnerId),
            learnerId: input.learnerId,
            courseId: rule.course_id,
            sourceType: 'RULE',
            sourceRef: rule.assignment_rule_version_id,
            dueAt,
          },
        });
        enrollmentId = assigned.enrollment.enrollmentId;
        outcome = assigned.idempotent ? 'SATISFIED' : 'ASSIGNED';
      }

      const execution = await persistExecution(client, {
        tenantId: input.tenantId,
        rule,
        learnerId: input.learnerId,
        triggerEventId: input.triggerEventId ?? null,
        actorSubjectId: input.actorSubjectId,
        correlationId: input.correlationId,
        outcome,
        enrollmentId,
        programEnrollmentId: null,
        evaluatedAt,
      });
      results.push(result(rule, execution, false));
      continue;
    }

    const current = await client.query<{ readonly program_version_id: string }>(
      `SELECT version.program_version_id
         FROM platform.learning_programs program
         JOIN platform.learning_program_versions version
           ON version.program_id = program.program_id
          AND version.tenant_id = program.tenant_id
          AND version.version = program.current_published_version
          AND version.state = 'PUBLISHED'
        WHERE program.tenant_id = $1::uuid
          AND program.program_id = $2::uuid
          AND program.status = 'ACTIVE'`,
      [input.tenantId, rule.program_id],
    );
    const programVersionId = current.rows[0]?.program_version_id;
    if (programVersionId === undefined) {
      throw new Error('LEARNING_ASSIGNMENT_RULE_TARGET_NOT_PUBLISHED');
    }

    const satisfied = await client.query<{
      readonly program_enrollment_id: string;
    }>(
      `SELECT program_enrollment_id
         FROM platform.learning_program_enrollments
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND program_version_id = $3::uuid
          AND status IN ('ASSIGNED','IN_PROGRESS','COMPLETED')
        ORDER BY assigned_at DESC, program_enrollment_id
        LIMIT 1`,
      [input.tenantId, input.learnerId, programVersionId],
    );
    const existingProgramEnrollmentId =
      satisfied.rows[0]?.program_enrollment_id ?? null;

    let programEnrollmentId = existingProgramEnrollmentId;
    let outcome: 'ASSIGNED' | 'SATISFIED' =
      existingProgramEnrollmentId === null ? 'ASSIGNED' : 'SATISFIED';

    if (programEnrollmentId === null) {
      const assigned = await createLearningProgramEnrollment(client, {
        tenantId: input.tenantId,
        actorSubjectId: input.actorSubjectId,
        correlationId: input.correlationId,
        learnerId: input.learnerId,
        programId: rule.program_id!,
        assignmentKey: assignmentKey(rule, input.learnerId),
        sourceType: 'RULE',
      });
      programEnrollmentId = assigned.enrollment.programEnrollmentId;
      outcome = assigned.idempotent ? 'SATISFIED' : 'ASSIGNED';
    }

    const execution = await persistExecution(client, {
      tenantId: input.tenantId,
      rule,
      learnerId: input.learnerId,
      triggerEventId: input.triggerEventId ?? null,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      outcome,
      enrollmentId: null,
      programEnrollmentId,
      evaluatedAt,
    });
    results.push(result(rule, execution, false));
  }

  return results;
}

function assignmentKey(rule: RuleVersionRow, learnerId: string): string {
  return `lar:${rule.assignment_rule_version_id}:${learnerId}`;
}

async function persistExecution(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly rule: RuleVersionRow;
    readonly learnerId: string;
    readonly triggerEventId: string | null;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly outcome: 'NOT_MATCHED' | 'ASSIGNED' | 'SATISFIED';
    readonly enrollmentId: string | null;
    readonly programEnrollmentId: string | null;
    readonly evaluatedAt: Date;
  },
): Promise<ExecutionRow> {
  const inserted = await client.query<ExecutionRow>(
    `INSERT INTO platform.learning_assignment_rule_executions (
       tenant_id, assignment_rule_version_id, learner_id, trigger_event_id,
       evaluated_by_subject_id, correlation_id, outcome, target_type,
       enrollment_id, program_enrollment_id, evaluated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5, $6, $7, $8, $9::uuid, $10::uuid, $11
     )
     ON CONFLICT (tenant_id, assignment_rule_version_id, learner_id)
     DO NOTHING
     RETURNING assignment_rule_execution_id, assignment_rule_version_id,
               learner_id, trigger_event_id, evaluated_by_subject_id,
               correlation_id, outcome, target_type, enrollment_id,
               program_enrollment_id, evaluated_at`,
    [
      input.tenantId,
      input.rule.assignment_rule_version_id,
      input.learnerId,
      input.triggerEventId,
      input.actorSubjectId,
      input.correlationId,
      input.outcome,
      input.rule.target_type,
      input.enrollmentId,
      input.programEnrollmentId,
      input.evaluatedAt,
    ],
  );
  const row = inserted.rows[0];
  if (row !== undefined) return row;

  const replay = await client.query<ExecutionRow>(
    `SELECT assignment_rule_execution_id, assignment_rule_version_id,
            learner_id, trigger_event_id, evaluated_by_subject_id,
            correlation_id, outcome, target_type, enrollment_id,
            program_enrollment_id, evaluated_at
       FROM platform.learning_assignment_rule_executions
      WHERE tenant_id = $1::uuid
        AND assignment_rule_version_id = $2::uuid
        AND learner_id = $3::uuid
      LIMIT 1`,
    [
      input.tenantId,
      input.rule.assignment_rule_version_id,
      input.learnerId,
    ],
  );
  const persisted = replay.rows[0];
  if (persisted === undefined) {
    throw new Error('LEARNING_ASSIGNMENT_RULE_EXECUTION_INSERT_FAILED');
  }
  return persisted;
}

function result(
  rule: RuleVersionRow,
  execution: ExecutionRow,
  idempotent: boolean,
): LearningAssignmentExecutionResult {
  return {
    assignmentRuleExecutionId: execution.assignment_rule_execution_id,
    assignmentRuleId: rule.assignment_rule_id,
    assignmentRuleVersionId: rule.assignment_rule_version_id,
    ruleKey: rule.rule_key,
    ruleVersion: rule.version,
    learnerId: execution.learner_id,
    outcome: execution.outcome,
    targetType: execution.target_type,
    enrollmentId: execution.enrollment_id,
    programEnrollmentId: execution.program_enrollment_id,
    triggerEventId: execution.trigger_event_id,
    evaluatedAt: iso(execution.evaluated_at),
    idempotent,
  };
}
