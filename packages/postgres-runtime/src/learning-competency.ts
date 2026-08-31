import { randomUUID } from 'node:crypto';
import {
  validateLearningCompetencyFrameworkDraft,
  type LearningCompetencyAchievementStatus,
  type LearningCompetencyEvidenceType,
} from '@expadio/learning';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { requireTenantModuleOperational } from './product-module.ts';

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FrameworkVersionRow {
  readonly competency_framework_version_id: string;
  readonly competency_framework_id: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  readonly title: string;
  readonly description: string;
}

interface RuleProjectionRow {
  readonly competency_framework_id: string;
  readonly framework_key: string;
  readonly competency_framework_version_id: string;
  readonly framework_version: number;
  readonly framework_title: string;
  readonly competency_definition_id: string;
  readonly competency_key: string;
  readonly competency_title: string;
  readonly competency_description: string;
  readonly competency_level_id: string;
  readonly level_key: string;
  readonly level_name: string;
  readonly rank: number;
  readonly competency_evidence_rule_id: string;
  readonly evidence_type: LearningCompetencyEvidenceType;
  readonly course_version_id: string | null;
  readonly assessment_version_id: string | null;
  readonly program_version_id: string | null;
  readonly certification_version_id: string | null;
  readonly required: boolean;
}

interface AchievementRow {
  readonly competency_achievement_id: string;
  readonly competency_definition_id: string;
  readonly competency_level_id: string;
  readonly achieved_rank: number;
  readonly status: LearningCompetencyAchievementStatus;
  readonly first_achieved_at: Date | string;
  readonly level_achieved_at: Date | string;
  readonly lapsed_at: Date | string | null;
  readonly last_reconciled_at: Date | string;
}

interface EvidenceSource {
  readonly sourceId: string;
  readonly observedAt: Date;
  readonly validUntil: Date | null;
  readonly valid: boolean;
}

interface EvidenceState {
  readonly ruleId: string;
  readonly type: LearningCompetencyEvidenceType;
  readonly source: EvidenceSource | null;
}

export interface LearningCompetencyFrameworkSummary {
  readonly competencyFrameworkId: string;
  readonly frameworkKey: string;
  readonly currentPublishedVersion: number | null;
  readonly publishedTitle: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

export interface LearningCompetencyProgress {
  readonly competencyFrameworkId: string;
  readonly frameworkKey: string;
  readonly competencyFrameworkVersionId: string;
  readonly frameworkVersion: number;
  readonly frameworkTitle: string;
  readonly competencyDefinitionId: string;
  readonly competencyKey: string;
  readonly competencyTitle: string;
  readonly competencyDescription: string;
  readonly status: 'NOT_ACHIEVED' | LearningCompetencyAchievementStatus;
  readonly currentLevel: {
    readonly competencyLevelId: string;
    readonly levelKey: string;
    readonly name: string;
    readonly rank: number;
  } | null;
  readonly firstAchievedAt: string | null;
  readonly levelAchievedAt: string | null;
  readonly lapsedAt: string | null;
  readonly levels: readonly {
    readonly competencyLevelId: string;
    readonly levelKey: string;
    readonly name: string;
    readonly rank: number;
    readonly qualified: boolean;
    readonly requiredEvidenceCount: number;
    readonly satisfiedRequiredEvidenceCount: number;
  }[];
}

export interface LearningCompetencyReconciliation {
  readonly learnerId: string;
  readonly competencies: readonly LearningCompetencyProgress[];
  readonly eventsEmitted: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function stableKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LEARNING_${field.toUpperCase()}_REQUIRED`);
  }
  const normalized = value.trim().toLowerCase();
  if (!KEY.test(normalized) || normalized.length > 160) {
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

export async function createLearningCompetencyFramework(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly frameworkKey: unknown;
    readonly draft: unknown;
  },
): Promise<{
  readonly competencyFrameworkId: string;
  readonly frameworkKey: string;
  readonly competencyFrameworkVersionId: string;
  readonly version: 1;
  readonly state: 'DRAFT';
}> {
  await requireLearning(client, input.tenantId);
  const frameworkKey = stableKey(input.frameworkKey, 'competency_framework_key');
  const draft = validateLearningCompetencyFrameworkDraft(input.draft);
  const academyId = await defaultAcademyId(client, input.tenantId);

  const courseIds = draft.competencies.flatMap((competency) =>
    competency.levels.flatMap((level) =>
      level.evidenceRules
        .map((rule) => rule.courseVersionId)
        .filter((id): id is string => id !== null),
    ),
  );
  const assessmentIds = draft.competencies.flatMap((competency) =>
    competency.levels.flatMap((level) =>
      level.evidenceRules
        .map((rule) => rule.assessmentVersionId)
        .filter((id): id is string => id !== null),
    ),
  );
  const programIds = draft.competencies.flatMap((competency) =>
    competency.levels.flatMap((level) =>
      level.evidenceRules
        .map((rule) => rule.programVersionId)
        .filter((id): id is string => id !== null),
    ),
  );
  const certificationIds = draft.competencies.flatMap((competency) =>
    competency.levels.flatMap((level) =>
      level.evidenceRules
        .map((rule) => rule.certificationVersionId)
        .filter((id): id is string => id !== null),
    ),
  );

  await assertVersionTargetsAvailable(client, input.tenantId, {
    courseIds,
    assessmentIds,
    programIds,
    certificationIds,
  });

  try {
    const frameworkResult = await client.query<{ readonly competency_framework_id: string }>(
      `INSERT INTO platform.learning_competency_frameworks (
         tenant_id, academy_id, framework_key, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING competency_framework_id`,
      [input.tenantId, academyId, frameworkKey, input.actorSubjectId],
    );
    const competencyFrameworkId = frameworkResult.rows[0]?.competency_framework_id;
    if (competencyFrameworkId === undefined) {
      throw new Error('LEARNING_COMPETENCY_FRAMEWORK_INSERT_FAILED');
    }

    const versionResult = await client.query<{
      readonly competency_framework_version_id: string;
    }>(
      `INSERT INTO platform.learning_competency_framework_versions (
         tenant_id, competency_framework_id, version, state, title,
         description, created_by_subject_id, updated_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 1, 'DRAFT', $3, $4, $5, $5
       )
       RETURNING competency_framework_version_id`,
      [
        input.tenantId,
        competencyFrameworkId,
        draft.title,
        draft.description,
        input.actorSubjectId,
      ],
    );
    const competencyFrameworkVersionId =
      versionResult.rows[0]?.competency_framework_version_id;
    if (competencyFrameworkVersionId === undefined) {
      throw new Error('LEARNING_COMPETENCY_FRAMEWORK_VERSION_INSERT_FAILED');
    }

    for (const competency of draft.competencies) {
      const definitionResult = await client.query<{
        readonly competency_definition_id: string;
      }>(
        `INSERT INTO platform.learning_competency_definitions (
           tenant_id, competency_framework_version_id, competency_key,
           title, description
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
         RETURNING competency_definition_id`,
        [
          input.tenantId,
          competencyFrameworkVersionId,
          competency.competencyKey,
          competency.title,
          competency.description,
        ],
      );
      const competencyDefinitionId =
        definitionResult.rows[0]?.competency_definition_id;
      if (competencyDefinitionId === undefined) {
        throw new Error('LEARNING_COMPETENCY_DEFINITION_INSERT_FAILED');
      }

      for (const level of competency.levels) {
        const levelResult = await client.query<{
          readonly competency_level_id: string;
        }>(
          `INSERT INTO platform.learning_competency_levels (
             tenant_id, competency_definition_id, level_key, name, rank
           ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
           RETURNING competency_level_id`,
          [
            input.tenantId,
            competencyDefinitionId,
            level.levelKey,
            level.name,
            level.rank,
          ],
        );
        const competencyLevelId = levelResult.rows[0]?.competency_level_id;
        if (competencyLevelId === undefined) {
          throw new Error('LEARNING_COMPETENCY_LEVEL_INSERT_FAILED');
        }

        for (const rule of level.evidenceRules) {
          await client.query(
            `INSERT INTO platform.learning_competency_evidence_rules (
               tenant_id, competency_level_id, evidence_type,
               course_version_id, assessment_version_id, program_version_id,
               certification_version_id, required
             ) VALUES (
               $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid,
               $7::uuid, $8
             )`,
            [
              input.tenantId,
              competencyLevelId,
              rule.type,
              rule.courseVersionId,
              rule.assessmentVersionId,
              rule.programVersionId,
              rule.certificationVersionId,
              rule.required,
            ],
          );
        }
      }
    }

    return {
      competencyFrameworkId,
      frameworkKey,
      competencyFrameworkVersionId,
      version: 1,
      state: 'DRAFT',
    };
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new Error('LEARNING_COMPETENCY_FRAMEWORK_KEY_EXISTS');
    }
    throw error;
  }
}

async function assertVersionTargetsAvailable(
  client: PostgresClient,
  tenantId: string,
  input: {
    readonly courseIds: readonly string[];
    readonly assessmentIds: readonly string[];
    readonly programIds: readonly string[];
    readonly certificationIds: readonly string[];
  },
): Promise<void> {
  const checks = [
    {
      ids: [...new Set(input.courseIds)],
      table: 'learning_course_versions',
      id: 'course_version_id',
      error: 'LEARNING_COMPETENCY_COURSE_VERSION_NOT_PUBLISHED',
    },
    {
      ids: [...new Set(input.assessmentIds)],
      table: 'learning_assessment_versions',
      id: 'assessment_version_id',
      error: 'LEARNING_COMPETENCY_ASSESSMENT_VERSION_NOT_PUBLISHED',
    },
    {
      ids: [...new Set(input.programIds)],
      table: 'learning_program_versions',
      id: 'program_version_id',
      error: 'LEARNING_COMPETENCY_PROGRAM_VERSION_NOT_PUBLISHED',
    },
    {
      ids: [...new Set(input.certificationIds)],
      table: 'learning_certification_versions',
      id: 'certification_version_id',
      error: 'LEARNING_COMPETENCY_CERTIFICATION_VERSION_NOT_PUBLISHED',
    },
  ] as const;

  for (const check of checks) {
    if (check.ids.length === 0) continue;
    const result = await client.query<{ readonly id: string; readonly state: string }>(
      `SELECT ${check.id} AS id, state
         FROM platform.${check.table}
        WHERE tenant_id = $1::uuid
          AND ${check.id} = ANY($2::uuid[])`,
      [tenantId, check.ids],
    );
    if (
      result.rows.length !== check.ids.length
      || result.rows.some((row) => !['PUBLISHED','SUPERSEDED'].includes(row.state))
    ) {
      throw new Error(check.error);
    }
  }
}

export async function listLearningCompetencyFrameworks(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningCompetencyFrameworkSummary[]> {
  await requireLearning(client, tenantId);
  const result = await client.query<{
    readonly competency_framework_id: string;
    readonly framework_key: string;
    readonly current_published_version: number | null;
    readonly published_title: string | null;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  }>(
    `SELECT framework.competency_framework_id, framework.framework_key,
            framework.current_published_version,
            version.title AS published_title,
            framework.status
       FROM platform.learning_competency_frameworks framework
       LEFT JOIN platform.learning_competency_framework_versions version
         ON version.competency_framework_id =
            framework.competency_framework_id
        AND version.tenant_id = framework.tenant_id
        AND version.state = 'PUBLISHED'
      WHERE framework.tenant_id = $1::uuid
      ORDER BY framework.updated_at DESC, framework.framework_key`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    competencyFrameworkId: row.competency_framework_id,
    frameworkKey: row.framework_key,
    currentPublishedVersion: row.current_published_version,
    publishedTitle: row.published_title,
    status: row.status,
  }));
}

export async function publishLearningCompetencyFrameworkVersion(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly competencyFrameworkId: string;
    readonly version: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly competencyFrameworkVersionId: string;
  readonly version: number;
  readonly idempotent: boolean;
}> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.competencyFrameworkId, 'competency_framework_id');

  const framework = await client.query(
    `SELECT 1
       FROM platform.learning_competency_frameworks
      WHERE tenant_id = $1::uuid
        AND competency_framework_id = $2::uuid
        AND status = 'ACTIVE'
      FOR UPDATE`,
    [input.tenantId, input.competencyFrameworkId],
  );
  if (framework.rows[0] === undefined) {
    throw new Error('LEARNING_COMPETENCY_FRAMEWORK_NOT_FOUND');
  }

  const versions = await client.query<FrameworkVersionRow>(
    `SELECT competency_framework_version_id, competency_framework_id,
            version, state, title, description
       FROM platform.learning_competency_framework_versions
      WHERE tenant_id = $1::uuid
        AND competency_framework_id = $2::uuid
        AND version = $3
      FOR UPDATE`,
    [input.tenantId, input.competencyFrameworkId, input.version],
  );
  const target = versions.rows[0];
  if (target === undefined) {
    throw new Error('LEARNING_COMPETENCY_FRAMEWORK_VERSION_NOT_FOUND');
  }
  if (target.state === 'PUBLISHED') {
    return {
      competencyFrameworkVersionId: target.competency_framework_version_id,
      version: target.version,
      idempotent: true,
    };
  }
  if (target.state !== 'DRAFT') {
    throw new Error('LEARNING_COMPETENCY_FRAMEWORK_VERSION_NOT_PUBLISHABLE');
  }

  await client.query(
    `UPDATE platform.learning_competency_framework_versions
        SET state = 'SUPERSEDED',
            updated_by_subject_id = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND competency_framework_id = $2::uuid
        AND state = 'PUBLISHED'
        AND version <> $4`,
    [
      input.tenantId,
      input.competencyFrameworkId,
      input.actorSubjectId,
      input.version,
    ],
  );

  await client.query(
    `UPDATE platform.learning_competency_framework_versions
        SET state = 'PUBLISHED',
            published_by_subject_id = $4,
            published_at = now(),
            updated_by_subject_id = $4,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND competency_framework_id = $2::uuid
        AND version = $3`,
    [
      input.tenantId,
      input.competencyFrameworkId,
      input.version,
      input.actorSubjectId,
    ],
  );

  await client.query(
    `UPDATE platform.learning_competency_frameworks
        SET current_published_version = $3,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND competency_framework_id = $2::uuid`,
    [input.tenantId, input.competencyFrameworkId, input.version],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.competency_framework',
      aggregateId: input.competencyFrameworkId,
      eventType: 'learning.competency.framework.version.published',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        competencyFrameworkVersionId:
          target.competency_framework_version_id,
        version: target.version,
      },
      metadata: { source: 'learning.competency.authoring' },
    },
  });

  return {
    competencyFrameworkVersionId: target.competency_framework_version_id,
    version: target.version,
    idempotent: false,
  };
}

export async function reconcileLearningCompetencies(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly now?: Date;
  },
): Promise<LearningCompetencyReconciliation> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.learnerId, 'learner_id');
  const now = input.now ?? new Date();

  const learner = await client.query<{ readonly status: string }>(
    `SELECT status
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
        AND learner_id = $2::uuid`,
    [input.tenantId, input.learnerId],
  );
  if (learner.rows[0] === undefined) throw new Error('LEARNING_LEARNER_NOT_FOUND');
  if (learner.rows[0].status !== 'ACTIVE') throw new Error('LEARNING_LEARNER_NOT_ACTIVE');

  const rows = await client.query<RuleProjectionRow>(
    `SELECT framework.competency_framework_id, framework.framework_key,
            framework_version.competency_framework_version_id,
            framework_version.version AS framework_version,
            framework_version.title AS framework_title,
            definition.competency_definition_id, definition.competency_key,
            definition.title AS competency_title,
            definition.description AS competency_description,
            level.competency_level_id, level.level_key,
            level.name AS level_name, level.rank,
            rule.competency_evidence_rule_id, rule.evidence_type,
            rule.course_version_id, rule.assessment_version_id,
            rule.program_version_id, rule.certification_version_id,
            rule.required
       FROM platform.learning_competency_frameworks framework
       JOIN platform.learning_competency_framework_versions framework_version
         ON framework_version.competency_framework_id =
            framework.competency_framework_id
        AND framework_version.tenant_id = framework.tenant_id
        AND framework_version.state = 'PUBLISHED'
       JOIN platform.learning_competency_definitions definition
         ON definition.competency_framework_version_id =
            framework_version.competency_framework_version_id
        AND definition.tenant_id = framework.tenant_id
       JOIN platform.learning_competency_levels level
         ON level.competency_definition_id =
            definition.competency_definition_id
        AND level.tenant_id = framework.tenant_id
       JOIN platform.learning_competency_evidence_rules rule
         ON rule.competency_level_id = level.competency_level_id
        AND rule.tenant_id = framework.tenant_id
      WHERE framework.tenant_id = $1::uuid
        AND framework.status = 'ACTIVE'
      ORDER BY framework.framework_key, definition.competency_key,
               level.rank, rule.competency_evidence_rule_id`,
    [input.tenantId],
  );

  const sources = await loadEvidenceSources(
    client,
    input.tenantId,
    input.learnerId,
    rows.rows,
    now,
  );

  const existingAchievements = await client.query<AchievementRow>(
    `SELECT competency_achievement_id, competency_definition_id,
            competency_level_id, achieved_rank, status,
            first_achieved_at, level_achieved_at, lapsed_at,
            last_reconciled_at
       FROM platform.learning_competency_achievements
      WHERE tenant_id = $1::uuid
        AND learner_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.learnerId],
  );
  const achievementByDefinition = new Map(
    existingAchievements.rows.map((row) => [row.competency_definition_id, row]),
  );

  const definitionGroups = groupDefinitions(rows.rows);
  const progress: LearningCompetencyProgress[] = [];
  let eventsEmitted = 0;

  for (const group of definitionGroups) {
    const evidenceStates = group.rules.map((rule): EvidenceState => ({
      ruleId: rule.competency_evidence_rule_id,
      type: rule.evidence_type,
      source: sourceForRule(sources, rule),
    }));

    for (const evidence of evidenceStates) {
      await persistEvidenceObservation(client, {
        tenantId: input.tenantId,
        learnerId: input.learnerId,
        definitionId: group.competencyDefinitionId,
        rule: group.rules.find(
          (candidate) =>
            candidate.competency_evidence_rule_id === evidence.ruleId,
        )!,
        evidence,
        now,
      });
    }

    const levels = [...group.levels].sort((a, b) => a.rank - b.rank);
    const levelStates = levels.map((level) => {
      const cumulativeRules = group.rules.filter(
        (rule) =>
          rule.required
          && group.levelRankById.get(rule.competency_level_id)! <= level.rank,
      );
      const satisfied = cumulativeRules.filter((rule) => {
        const state = evidenceStates.find(
          (candidate) =>
            candidate.ruleId === rule.competency_evidence_rule_id,
        );
        return state?.source?.valid === true;
      }).length;
      return {
        ...level,
        qualified:
          cumulativeRules.length > 0
          && satisfied === cumulativeRules.length,
        requiredEvidenceCount: cumulativeRules.length,
        satisfiedRequiredEvidenceCount: satisfied,
      };
    });

    const highest = [...levelStates]
      .filter((level) => level.qualified)
      .sort((a, b) => b.rank - a.rank)[0] ?? null;

    const existing = achievementByDefinition.get(group.competencyDefinitionId);
    let effective = existing ?? null;

    if (highest !== null) {
      if (existing === undefined) {
        const inserted = await client.query<AchievementRow>(
          `INSERT INTO platform.learning_competency_achievements (
             tenant_id, learner_id, competency_definition_id,
             competency_level_id, achieved_rank, status,
             first_achieved_at, level_achieved_at, last_reconciled_at
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'ACTIVE',
             $6, $6, $6
           )
           RETURNING competency_achievement_id,
                     competency_definition_id, competency_level_id,
                     achieved_rank, status, first_achieved_at,
                     level_achieved_at, lapsed_at, last_reconciled_at`,
          [
            input.tenantId,
            input.learnerId,
            group.competencyDefinitionId,
            highest.competencyLevelId,
            highest.rank,
            now,
          ],
        );
        effective = inserted.rows[0] ?? null;
        await emitCompetencyEvent(client, {
          tenantId: input.tenantId,
          actorSubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          definitionId: group.competencyDefinitionId,
          eventType: 'learning.competency.achieved',
          learnerId: input.learnerId,
          frameworkVersionId: group.competencyFrameworkVersionId,
          competencyKey: group.competencyKey,
          levelKey: highest.levelKey,
          rank: highest.rank,
          occurredAt: now,
        });
        eventsEmitted += 1;
      } else if (
        existing.status !== 'ACTIVE'
        || existing.competency_level_id !== highest.competencyLevelId
      ) {
        const eventType =
          existing.status === 'LAPSED'
          && existing.competency_level_id === highest.competencyLevelId
            ? 'learning.competency.achieved'
            : 'learning.competency.level.changed';

        const updated = await client.query<AchievementRow>(
          `UPDATE platform.learning_competency_achievements
              SET competency_level_id = $4::uuid,
                  achieved_rank = $5,
                  status = 'ACTIVE',
                  level_achieved_at = CASE
                    WHEN competency_level_id IS DISTINCT FROM $4::uuid
                    THEN $6
                    ELSE level_achieved_at
                  END,
                  lapsed_at = NULL,
                  last_reconciled_at = $6,
                  updated_at = now()
            WHERE tenant_id = $1::uuid
              AND learner_id = $2::uuid
              AND competency_definition_id = $3::uuid
            RETURNING competency_achievement_id,
                      competency_definition_id, competency_level_id,
                      achieved_rank, status, first_achieved_at,
                      level_achieved_at, lapsed_at, last_reconciled_at`,
          [
            input.tenantId,
            input.learnerId,
            group.competencyDefinitionId,
            highest.competencyLevelId,
            highest.rank,
            now,
          ],
        );
        effective = updated.rows[0] ?? null;
        await emitCompetencyEvent(client, {
          tenantId: input.tenantId,
          actorSubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          definitionId: group.competencyDefinitionId,
          eventType,
          learnerId: input.learnerId,
          frameworkVersionId: group.competencyFrameworkVersionId,
          competencyKey: group.competencyKey,
          levelKey: highest.levelKey,
          rank: highest.rank,
          occurredAt: now,
        });
        eventsEmitted += 1;
      } else {
        await client.query(
          `UPDATE platform.learning_competency_achievements
              SET last_reconciled_at = $4,
                  updated_at = now()
            WHERE tenant_id = $1::uuid
              AND learner_id = $2::uuid
              AND competency_definition_id = $3::uuid`,
          [
            input.tenantId,
            input.learnerId,
            group.competencyDefinitionId,
            now,
          ],
        );
        effective = {
          ...existing,
          last_reconciled_at: now,
        };
      }
    } else if (existing !== undefined) {
      if (existing.status === 'ACTIVE') {
        const updated = await client.query<AchievementRow>(
          `UPDATE platform.learning_competency_achievements
              SET status = 'LAPSED',
                  lapsed_at = $4,
                  last_reconciled_at = $4,
                  updated_at = now()
            WHERE tenant_id = $1::uuid
              AND learner_id = $2::uuid
              AND competency_definition_id = $3::uuid
            RETURNING competency_achievement_id,
                      competency_definition_id, competency_level_id,
                      achieved_rank, status, first_achieved_at,
                      level_achieved_at, lapsed_at, last_reconciled_at`,
          [
            input.tenantId,
            input.learnerId,
            group.competencyDefinitionId,
            now,
          ],
        );
        effective = updated.rows[0] ?? null;
        const lastLevel = levels.find(
          (level) =>
            level.competencyLevelId === existing.competency_level_id,
        );
        await emitCompetencyEvent(client, {
          tenantId: input.tenantId,
          actorSubjectId: input.actorSubjectId,
          correlationId: input.correlationId,
          definitionId: group.competencyDefinitionId,
          eventType: 'learning.competency.lapsed',
          learnerId: input.learnerId,
          frameworkVersionId: group.competencyFrameworkVersionId,
          competencyKey: group.competencyKey,
          levelKey: lastLevel?.levelKey ?? 'unknown',
          rank: existing.achieved_rank,
          occurredAt: now,
        });
        eventsEmitted += 1;
      } else {
        await client.query(
          `UPDATE platform.learning_competency_achievements
              SET last_reconciled_at = $4,
                  updated_at = now()
            WHERE tenant_id = $1::uuid
              AND learner_id = $2::uuid
              AND competency_definition_id = $3::uuid`,
          [
            input.tenantId,
            input.learnerId,
            group.competencyDefinitionId,
            now,
          ],
        );
        effective = {
          ...existing,
          last_reconciled_at: now,
        };
      }
    }

    const currentLevel =
      effective === null
        ? null
        : levels.find(
            (level) =>
              level.competencyLevelId === effective!.competency_level_id,
          ) ?? null;

    progress.push({
      competencyFrameworkId: group.competencyFrameworkId,
      frameworkKey: group.frameworkKey,
      competencyFrameworkVersionId: group.competencyFrameworkVersionId,
      frameworkVersion: group.frameworkVersion,
      frameworkTitle: group.frameworkTitle,
      competencyDefinitionId: group.competencyDefinitionId,
      competencyKey: group.competencyKey,
      competencyTitle: group.competencyTitle,
      competencyDescription: group.competencyDescription,
      status: effective?.status ?? 'NOT_ACHIEVED',
      currentLevel:
        currentLevel === null
          ? null
          : {
              competencyLevelId: currentLevel.competencyLevelId,
              levelKey: currentLevel.levelKey,
              name: currentLevel.name,
              rank: currentLevel.rank,
            },
      firstAchievedAt:
        effective === null ? null : iso(effective.first_achieved_at),
      levelAchievedAt:
        effective === null ? null : iso(effective.level_achieved_at),
      lapsedAt:
        effective === null ? null : nullableIso(effective.lapsed_at),
      levels: levelStates.map((level) => ({
        competencyLevelId: level.competencyLevelId,
        levelKey: level.levelKey,
        name: level.name,
        rank: level.rank,
        qualified: level.qualified,
        requiredEvidenceCount: level.requiredEvidenceCount,
        satisfiedRequiredEvidenceCount:
          level.satisfiedRequiredEvidenceCount,
      })),
    });
  }

  return {
    learnerId: input.learnerId,
    competencies: progress,
    eventsEmitted,
  };
}

function groupDefinitions(rows: readonly RuleProjectionRow[]): readonly {
  competencyFrameworkId: string;
  frameworkKey: string;
  competencyFrameworkVersionId: string;
  frameworkVersion: number;
  frameworkTitle: string;
  competencyDefinitionId: string;
  competencyKey: string;
  competencyTitle: string;
  competencyDescription: string;
  levels: readonly {
    competencyLevelId: string;
    levelKey: string;
    name: string;
    rank: number;
  }[];
  levelRankById: ReadonlyMap<string, number>;
  rules: readonly RuleProjectionRow[];
}[] {
  const groups = new Map<string, RuleProjectionRow[]>();
  for (const row of rows) {
    const current = groups.get(row.competency_definition_id) ?? [];
    current.push(row);
    groups.set(row.competency_definition_id, current);
  }

  return [...groups.values()].map((groupRows) => {
    const first = groupRows[0]!;
    const levels = new Map<
      string,
      { competencyLevelId: string; levelKey: string; name: string; rank: number }
    >();
    for (const row of groupRows) {
      levels.set(row.competency_level_id, {
        competencyLevelId: row.competency_level_id,
        levelKey: row.level_key,
        name: row.level_name,
        rank: row.rank,
      });
    }
    const levelList = [...levels.values()].sort((a, b) => a.rank - b.rank);
    return {
      competencyFrameworkId: first.competency_framework_id,
      frameworkKey: first.framework_key,
      competencyFrameworkVersionId:
        first.competency_framework_version_id,
      frameworkVersion: first.framework_version,
      frameworkTitle: first.framework_title,
      competencyDefinitionId: first.competency_definition_id,
      competencyKey: first.competency_key,
      competencyTitle: first.competency_title,
      competencyDescription: first.competency_description,
      levels: levelList,
      levelRankById: new Map(
        levelList.map((level) => [level.competencyLevelId, level.rank]),
      ),
      rules: groupRows,
    };
  });
}

interface SourceMaps {
  readonly courses: ReadonlyMap<string, EvidenceSource>;
  readonly assessments: ReadonlyMap<string, EvidenceSource>;
  readonly programs: ReadonlyMap<string, EvidenceSource>;
  readonly certifications: ReadonlyMap<string, EvidenceSource>;
}

async function loadEvidenceSources(
  client: PostgresClient,
  tenantId: string,
  learnerId: string,
  rules: readonly RuleProjectionRow[],
  now: Date,
): Promise<SourceMaps> {
  const courseIds = uniqueTargets(rules, 'course_version_id');
  const assessmentIds = uniqueTargets(rules, 'assessment_version_id');
  const programIds = uniqueTargets(rules, 'program_version_id');
  const certificationIds = uniqueTargets(rules, 'certification_version_id');

  const [courseRows, assessmentRows, programRows, credentialRows] =
    await Promise.all([
      courseIds.length === 0
        ? Promise.resolve({ rows: [] as readonly {
            course_version_id: string;
            source_id: string;
            observed_at: Date | string;
          }[] })
        : client.query<{
            readonly course_version_id: string;
            readonly source_id: string;
            readonly observed_at: Date | string;
          }>(
            `SELECT DISTINCT ON (course_version_id)
                    course_version_id,
                    enrollment_id AS source_id,
                    completed_at AS observed_at
               FROM platform.learning_enrollments
              WHERE tenant_id = $1::uuid
                AND learner_id = $2::uuid
                AND course_version_id = ANY($3::uuid[])
                AND status = 'COMPLETED'
                AND completed_at IS NOT NULL
              ORDER BY course_version_id, completed_at, enrollment_id`,
            [tenantId, learnerId, courseIds],
          ),
      assessmentIds.length === 0
        ? Promise.resolve({ rows: [] as readonly {
            assessment_version_id: string;
            source_id: string;
            observed_at: Date | string;
          }[] })
        : client.query<{
            readonly assessment_version_id: string;
            readonly source_id: string;
            readonly observed_at: Date | string;
          }>(
            `SELECT DISTINCT ON (assessment_version_id)
                    assessment_version_id,
                    attempt_id AS source_id,
                    graded_at AS observed_at
               FROM platform.learning_assessment_attempts
              WHERE tenant_id = $1::uuid
                AND learner_id = $2::uuid
                AND assessment_version_id = ANY($3::uuid[])
                AND status = 'GRADED'
                AND passed = true
                AND graded_at IS NOT NULL
              ORDER BY assessment_version_id, graded_at, attempt_id`,
            [tenantId, learnerId, assessmentIds],
          ),
      programIds.length === 0
        ? Promise.resolve({ rows: [] as readonly {
            program_version_id: string;
            source_id: string;
            observed_at: Date | string;
          }[] })
        : client.query<{
            readonly program_version_id: string;
            readonly source_id: string;
            readonly observed_at: Date | string;
          }>(
            `SELECT DISTINCT ON (program_version_id)
                    program_version_id,
                    program_enrollment_id AS source_id,
                    completed_at AS observed_at
               FROM platform.learning_program_enrollments
              WHERE tenant_id = $1::uuid
                AND learner_id = $2::uuid
                AND program_version_id = ANY($3::uuid[])
                AND status = 'COMPLETED'
                AND completed_at IS NOT NULL
              ORDER BY program_version_id, completed_at,
                       program_enrollment_id`,
            [tenantId, learnerId, programIds],
          ),
      certificationIds.length === 0
        ? Promise.resolve({ rows: [] as readonly {
            certification_version_id: string;
            source_id: string;
            observed_at: Date | string;
            valid_until: Date | string | null;
            status: string;
          }[] })
        : client.query<{
            readonly certification_version_id: string;
            readonly source_id: string;
            readonly observed_at: Date | string;
            readonly valid_until: Date | string | null;
            readonly status: string;
          }>(
            `SELECT certification_version_id,
                    credential_id AS source_id,
                    issued_at AS observed_at,
                    expires_at AS valid_until,
                    status
               FROM platform.learning_credentials
              WHERE tenant_id = $1::uuid
                AND learner_id = $2::uuid
                AND certification_version_id = ANY($3::uuid[])`,
            [tenantId, learnerId, certificationIds],
          ),
    ]);

  const courses = new Map<string, EvidenceSource>();
  for (const row of courseRows.rows) {
    courses.set(row.course_version_id, {
      sourceId: row.source_id,
      observedAt: new Date(row.observed_at),
      validUntil: null,
      valid: true,
    });
  }

  const assessments = new Map<string, EvidenceSource>();
  for (const row of assessmentRows.rows) {
    assessments.set(row.assessment_version_id, {
      sourceId: row.source_id,
      observedAt: new Date(row.observed_at),
      validUntil: null,
      valid: true,
    });
  }

  const programs = new Map<string, EvidenceSource>();
  for (const row of programRows.rows) {
    programs.set(row.program_version_id, {
      sourceId: row.source_id,
      observedAt: new Date(row.observed_at),
      validUntil: null,
      valid: true,
    });
  }

  const certifications = new Map<string, EvidenceSource>();
  for (const row of credentialRows.rows) {
    const validUntil =
      row.valid_until === null ? null : new Date(row.valid_until);
    certifications.set(row.certification_version_id, {
      sourceId: row.source_id,
      observedAt: new Date(row.observed_at),
      validUntil,
      valid:
        row.status !== 'REVOKED'
        && (validUntil === null || now.getTime() < validUntil.getTime()),
    });
  }

  return { courses, assessments, programs, certifications };
}

function uniqueTargets(
  rules: readonly RuleProjectionRow[],
  field:
    | 'course_version_id'
    | 'assessment_version_id'
    | 'program_version_id'
    | 'certification_version_id',
): readonly string[] {
  return [
    ...new Set(
      rules
        .map((rule) => rule[field])
        .filter((id): id is string => id !== null),
    ),
  ];
}

function sourceForRule(
  sources: SourceMaps,
  rule: RuleProjectionRow,
): EvidenceSource | null {
  if (rule.evidence_type === 'COURSE_COMPLETION') {
    return sources.courses.get(rule.course_version_id!) ?? null;
  }
  if (rule.evidence_type === 'ASSESSMENT_PASS') {
    return sources.assessments.get(rule.assessment_version_id!) ?? null;
  }
  if (rule.evidence_type === 'PROGRAM_COMPLETION') {
    return sources.programs.get(rule.program_version_id!) ?? null;
  }
  return sources.certifications.get(rule.certification_version_id!) ?? null;
}

async function persistEvidenceObservation(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId: string;
    readonly definitionId: string;
    readonly rule: RuleProjectionRow;
    readonly evidence: EvidenceState;
    readonly now: Date;
  },
): Promise<void> {
  if (input.evidence.source === null) {
    await client.query(
      `UPDATE platform.learning_competency_evidence
          SET currently_valid = false,
              last_verified_at = $4,
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND learner_id = $2::uuid
          AND competency_evidence_rule_id = $3::uuid`,
      [
        input.tenantId,
        input.learnerId,
        input.rule.competency_evidence_rule_id,
        input.now,
      ],
    );
    return;
  }

  const source = input.evidence.source;
  await client.query(
    `INSERT INTO platform.learning_competency_evidence (
       tenant_id, learner_id, competency_definition_id,
       competency_level_id, competency_evidence_rule_id,
       evidence_type, source_id, observed_at, valid_until,
       currently_valid, last_verified_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       $6, $7::uuid, $8, $9, $10, $11
     )
     ON CONFLICT (tenant_id, learner_id, competency_evidence_rule_id)
     DO UPDATE SET
       valid_until = EXCLUDED.valid_until,
       currently_valid = EXCLUDED.currently_valid,
       last_verified_at = EXCLUDED.last_verified_at,
       updated_at = now()`,
    [
      input.tenantId,
      input.learnerId,
      input.definitionId,
      input.rule.competency_level_id,
      input.rule.competency_evidence_rule_id,
      input.rule.evidence_type,
      source.sourceId,
      source.observedAt,
      source.validUntil,
      source.valid,
      input.now,
    ],
  );
}

async function emitCompetencyEvent(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly definitionId: string;
    readonly eventType:
      | 'learning.competency.achieved'
      | 'learning.competency.level.changed'
      | 'learning.competency.lapsed';
    readonly learnerId: string;
    readonly frameworkVersionId: string;
    readonly competencyKey: string;
    readonly levelKey: string;
    readonly rank: number;
    readonly occurredAt: Date;
  },
): Promise<void> {
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.competency',
      aggregateId: input.definitionId,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt: input.occurredAt,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        learnerId: input.learnerId,
        competencyFrameworkVersionId: input.frameworkVersionId,
        competencyDefinitionId: input.definitionId,
        competencyKey: input.competencyKey,
        levelKey: input.levelKey,
        rank: input.rank,
      },
      metadata: { source: 'learning.competency.reconciliation' },
    },
  });
}

export async function reconcileMyLearningCompetencies(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly correlationId: string;
    readonly now?: Date;
  },
): Promise<LearningCompetencyReconciliation> {
  await requireLearning(client, input.tenantId);
  const learnerId = await resolveActiveLearnerId(client, input);
  return reconcileLearningCompetencies(client, {
    tenantId: input.tenantId,
    learnerId,
    actorSubjectId: input.subjectId,
    correlationId: input.correlationId,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function listMyLearningCompetencies(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
  },
): Promise<readonly LearningCompetencyProgress[]> {
  await requireLearning(client, input.tenantId);
  const learnerId = await resolveActiveLearnerId(client, input);
  return loadCompetencyProgress(client, input.tenantId, learnerId);
}

export async function listLearningCompetenciesForLearner(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learnerId: string;
  },
): Promise<readonly LearningCompetencyProgress[]> {
  await requireLearning(client, input.tenantId);
  stableUuid(input.learnerId, 'learner_id');
  return loadCompetencyProgress(client, input.tenantId, input.learnerId);
}

async function loadCompetencyProgress(
  client: PostgresClient,
  tenantId: string,
  learnerId: string,
): Promise<readonly LearningCompetencyProgress[]> {
  const rows = await client.query<{
    readonly competency_framework_id: string;
    readonly framework_key: string;
    readonly competency_framework_version_id: string;
    readonly framework_version: number;
    readonly framework_title: string;
    readonly competency_definition_id: string;
    readonly competency_key: string;
    readonly competency_title: string;
    readonly competency_description: string;
    readonly competency_level_id: string;
    readonly level_key: string;
    readonly level_name: string;
    readonly rank: number;
    readonly achievement_level_id: string | null;
    readonly achievement_rank: number | null;
    readonly achievement_status: LearningCompetencyAchievementStatus | null;
    readonly first_achieved_at: Date | string | null;
    readonly level_achieved_at: Date | string | null;
    readonly lapsed_at: Date | string | null;
    readonly required_count: string | number;
    readonly satisfied_count: string | number;
  }>(
    `SELECT framework.competency_framework_id, framework.framework_key,
            framework_version.competency_framework_version_id,
            framework_version.version AS framework_version,
            framework_version.title AS framework_title,
            definition.competency_definition_id, definition.competency_key,
            definition.title AS competency_title,
            definition.description AS competency_description,
            level.competency_level_id, level.level_key,
            level.name AS level_name, level.rank,
            achievement.competency_level_id AS achievement_level_id,
            achievement.achieved_rank AS achievement_rank,
            achievement.status AS achievement_status,
            achievement.first_achieved_at, achievement.level_achieved_at,
            achievement.lapsed_at,
            count(rule.competency_evidence_rule_id) FILTER (
              WHERE rule.required = true
                AND required_level.rank <= level.rank
            ) AS required_count,
            count(evidence.competency_evidence_id) FILTER (
              WHERE rule.required = true
                AND required_level.rank <= level.rank
                AND evidence.currently_valid = true
            ) AS satisfied_count
       FROM platform.learning_competency_frameworks framework
       JOIN platform.learning_competency_framework_versions framework_version
         ON framework_version.competency_framework_id =
            framework.competency_framework_id
        AND framework_version.tenant_id = framework.tenant_id
        AND framework_version.state = 'PUBLISHED'
       JOIN platform.learning_competency_definitions definition
         ON definition.competency_framework_version_id =
            framework_version.competency_framework_version_id
        AND definition.tenant_id = framework.tenant_id
       JOIN platform.learning_competency_levels level
         ON level.competency_definition_id =
            definition.competency_definition_id
        AND level.tenant_id = framework.tenant_id
       JOIN platform.learning_competency_levels required_level
         ON required_level.competency_definition_id =
            definition.competency_definition_id
        AND required_level.tenant_id = framework.tenant_id
        AND required_level.rank <= level.rank
       JOIN platform.learning_competency_evidence_rules rule
         ON rule.competency_level_id = required_level.competency_level_id
        AND rule.tenant_id = framework.tenant_id
       LEFT JOIN platform.learning_competency_evidence evidence
         ON evidence.competency_evidence_rule_id =
            rule.competency_evidence_rule_id
        AND evidence.tenant_id = framework.tenant_id
        AND evidence.learner_id = $2::uuid
       LEFT JOIN platform.learning_competency_achievements achievement
         ON achievement.competency_definition_id =
            definition.competency_definition_id
        AND achievement.tenant_id = framework.tenant_id
        AND achievement.learner_id = $2::uuid
      WHERE framework.tenant_id = $1::uuid
        AND framework.status = 'ACTIVE'
      GROUP BY framework.competency_framework_id, framework.framework_key,
               framework_version.competency_framework_version_id,
               framework_version.version, framework_version.title,
               definition.competency_definition_id, definition.competency_key,
               definition.title, definition.description,
               level.competency_level_id, level.level_key, level.name,
               level.rank, achievement.competency_level_id,
               achievement.achieved_rank, achievement.status,
               achievement.first_achieved_at, achievement.level_achieved_at,
               achievement.lapsed_at
      ORDER BY framework.framework_key, definition.competency_key, level.rank`,
    [tenantId, learnerId],
  );

  const groups = new Map<string, typeof rows.rows>();
  for (const row of rows.rows) {
    const current = groups.get(row.competency_definition_id) ?? [];
    current.push(row);
    groups.set(row.competency_definition_id, current);
  }

  return [...groups.values()].map((groupRows) => {
    const first = groupRows[0]!;
    const current = groupRows.find(
      (row) => row.competency_level_id === row.achievement_level_id,
    );
    return {
      competencyFrameworkId: first.competency_framework_id,
      frameworkKey: first.framework_key,
      competencyFrameworkVersionId:
        first.competency_framework_version_id,
      frameworkVersion: first.framework_version,
      frameworkTitle: first.framework_title,
      competencyDefinitionId: first.competency_definition_id,
      competencyKey: first.competency_key,
      competencyTitle: first.competency_title,
      competencyDescription: first.competency_description,
      status: first.achievement_status ?? 'NOT_ACHIEVED',
      currentLevel:
        current === undefined
          ? null
          : {
              competencyLevelId: current.competency_level_id,
              levelKey: current.level_key,
              name: current.level_name,
              rank: current.rank,
            },
      firstAchievedAt:
        first.first_achieved_at === null
          ? null
          : iso(first.first_achieved_at),
      levelAchievedAt:
        first.level_achieved_at === null
          ? null
          : iso(first.level_achieved_at),
      lapsedAt:
        first.lapsed_at === null ? null : iso(first.lapsed_at),
      levels: groupRows.map((row) => {
        const required = Number(row.required_count);
        const satisfied = Number(row.satisfied_count);
        return {
          competencyLevelId: row.competency_level_id,
          levelKey: row.level_key,
          name: row.level_name,
          rank: row.rank,
          qualified: required > 0 && required === satisfied,
          requiredEvidenceCount: required,
          satisfiedRequiredEvidenceCount: satisfied,
        };
      }),
    };
  });
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
