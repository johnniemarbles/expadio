import { randomUUID } from 'node:crypto';
import {
  replayAiJob,
  type AiJobRegistration,
  type AiOperation,
} from '@expadio/ai-gateway';
import { PostgresAiJobRepository } from './ai-job.ts';
import {
  aiArtifactReference,
  createAiJobArtifact,
  loadAiJobArtifact,
} from './ai-artifact.ts';
import { enqueueAiJob } from './ai-execution-queue.ts';
import type { PostgresClient } from './index.ts';
import { requireTenantModuleOperational } from './product-module.ts';

export type LearningAiRequestType =
  | 'TUTOR'
  | 'AUTHOR_DRAFT'
  | 'ASSESSMENT_FEEDBACK'
  | 'COACH';

interface RequestRow {
  readonly learning_ai_request_id: string;
  readonly tenant_id: string;
  readonly job_id: string;
  readonly request_type: LearningAiRequestType;
  readonly learner_id: string | null;
  readonly course_id: string | null;
  readonly course_version_id: string | null;
  readonly requested_by_subject_id: string;
  readonly prompt_key: string;
  readonly prompt_version: number;
  readonly input_artifact_id: string;
  readonly context_artifact_id: string | null;
  readonly created_at: Date | string;
  readonly correlation_id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LearningAiRequest {
  readonly learningAiRequestId: string;
  readonly jobId: string;
  readonly requestType: LearningAiRequestType;
  readonly learnerId: string | null;
  readonly courseId: string | null;
  readonly courseVersionId: string | null;
  readonly requestedBySubjectId: string;
  readonly promptKey: string;
  readonly promptVersion: number;
  readonly inputArtifactReference: string;
  readonly contextArtifactReference: string | null;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LearningAiRequestStatus extends LearningAiRequest {
  readonly jobStatus:
    | 'QUEUED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED';
  readonly outputReference: string | null;
  readonly output:
    | {
        readonly mediaType: string;
        readonly content: string;
      }
    | null;
  readonly confidence: number | null;
  readonly costMinorUnits: number | null;
  readonly lastFailureCode: string | null;
}

const TYPE_CONFIG: Readonly<Record<
  LearningAiRequestType,
  {
    readonly operation: AiOperation;
    readonly purpose: string;
    readonly promptKey: string;
    readonly promptVersion: number;
    readonly maximumCostMinorUnits: number;
  }
>> = {
  TUTOR: {
    operation: 'GENERATE',
    purpose: 'Provide a grounded Learning tutor response for the authenticated learner.',
    promptKey: 'prompt.learning.tutor',
    promptVersion: 1,
    maximumCostMinorUnits: 25,
  },
  AUTHOR_DRAFT: {
    operation: 'GENERATE',
    purpose: 'Draft Learning content for administrator review; never publish automatically.',
    promptKey: 'prompt.learning.author_draft',
    promptVersion: 1,
    maximumCostMinorUnits: 50,
  },
  ASSESSMENT_FEEDBACK: {
    operation: 'GENERATE',
    purpose: 'Draft formative assessment feedback for human or deterministic review.',
    promptKey: 'prompt.learning.assessment_feedback',
    promptVersion: 1,
    maximumCostMinorUnits: 25,
  },
  COACH: {
    operation: 'GENERATE',
    purpose: 'Provide learner coaching without mutating competency or certification state.',
    promptKey: 'prompt.learning.coach',
    promptVersion: 1,
    maximumCostMinorUnits: 25,
  },
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function map(row: RequestRow): LearningAiRequest {
  return {
    learningAiRequestId: row.learning_ai_request_id,
    jobId: row.job_id,
    requestType: row.request_type,
    learnerId: row.learner_id,
    courseId: row.course_id,
    courseVersionId: row.course_version_id,
    requestedBySubjectId: row.requested_by_subject_id,
    promptKey: row.prompt_key,
    promptVersion: row.prompt_version,
    inputArtifactReference: aiArtifactReference(row.input_artifact_id),
    contextArtifactReference:
      row.context_artifact_id === null
        ? null
        : aiArtifactReference(row.context_artifact_id),
    createdAt: iso(row.created_at),
    correlationId: row.correlation_id,
    metadata: row.metadata,
  };
}

async function requireLearningAi(
  client: PostgresClient,
  tenantId: string,
): Promise<void> {
  await requireTenantModuleOperational(client, {
    tenantId,
    moduleKey: 'learning',
  });
  const result = await client.query<{ readonly ai_features_enabled: boolean }>(
    `SELECT ai_features_enabled
       FROM platform.learning_tenant_settings
      WHERE tenant_id = $1::uuid
      LIMIT 1`,
    [tenantId],
  );
  if (result.rows[0]?.ai_features_enabled !== true) {
    throw new Error('LEARNING_AI_FEATURES_DISABLED');
  }
}

async function resolveCallerLearner(
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
        AND (
          subject_issuer = $3
          OR ($3 IS NULL AND subject_issuer IS NULL)
        )
        AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.subjectId, input.subjectIssuer],
  );
  const learnerId = result.rows[0]?.learner_id;
  if (learnerId === undefined) throw new Error('LEARNING_AI_LEARNER_ACCESS_DENIED');
  return learnerId;
}

async function resolveCourseContext(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly courseId?: string;
  },
): Promise<{
  readonly courseId: string | null;
  readonly courseVersionId: string | null;
  readonly content: string | null;
}> {
  if (input.courseId === undefined) {
    return { courseId: null, courseVersionId: null, content: null };
  }

  const result = await client.query<{
    readonly course_id: string;
    readonly course_version_id: string;
    readonly course_key: string;
    readonly version: number;
    readonly title: string;
    readonly summary: string;
    readonly description: string;
    readonly language: string;
    readonly learning_objectives: readonly string[];
  }>(
    `SELECT course.course_id, version.course_version_id,
            course.course_key, version.version, version.title,
            version.summary, version.description, version.language,
            version.learning_objectives
       FROM platform.learning_courses course
       JOIN platform.learning_course_versions version
         ON version.tenant_id = course.tenant_id
        AND version.course_id = course.course_id
        AND version.version = course.current_published_version
        AND version.state = 'PUBLISHED'
      WHERE course.tenant_id = $1::uuid
        AND course.course_id = $2::uuid
        AND course.status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.courseId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_AI_COURSE_NOT_FOUND');

  return {
    courseId: row.course_id,
    courseVersionId: row.course_version_id,
    content: JSON.stringify({
      courseKey: row.course_key,
      version: row.version,
      title: row.title,
      summary: row.summary,
      description: row.description,
      language: row.language,
      learningObjectives: row.learning_objectives,
    }),
  };
}

function stableIdempotency(value: string): string {
  const normalized = value.trim();
  if (
    normalized === ''
    || normalized.length > 240
    || /[\r\n\t]/u.test(normalized)
  ) {
    throw new Error('LEARNING_AI_IDEMPOTENCY_KEY_INVALID');
  }
  return normalized;
}

function prompt(value: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error('LEARNING_AI_PROMPT_REQUIRED');
  if (normalized.length > 20_000) throw new Error('LEARNING_AI_PROMPT_TOO_LONG');
  return normalized;
}

async function requireEquivalentReplay(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly existing: LearningAiRequest;
    readonly requestType: LearningAiRequestType;
    readonly promptText: string;
    readonly courseId: string | null;
  },
): Promise<void> {
  if (
    input.existing.requestType !== input.requestType
    || input.existing.courseId !== input.courseId
  ) {
    throw new Error('LEARNING_AI_IDEMPOTENCY_CONFLICT');
  }
  const artifact = await loadAiJobArtifact(client, {
    tenantId: input.tenantId,
    jobId: input.existing.jobId,
    reference: input.existing.inputArtifactReference,
    expectedType: 'INPUT',
  });
  if (artifact.content !== input.promptText) {
    throw new Error('LEARNING_AI_IDEMPOTENCY_CONFLICT');
  }
}

async function findExistingByJob(
  client: PostgresClient,
  tenantId: string,
  jobId: string,
): Promise<LearningAiRequest | null> {
  const result = await client.query<RequestRow>(
    `SELECT learning_ai_request_id, tenant_id, job_id, request_type,
            learner_id, course_id, course_version_id,
            requested_by_subject_id, prompt_key, prompt_version,
            input_artifact_id, context_artifact_id, created_at,
            correlation_id, metadata
       FROM platform.learning_ai_requests
      WHERE tenant_id = $1::uuid
        AND job_id = $2::uuid
      LIMIT 1`,
    [tenantId, jobId],
  );
  return result.rows[0] === undefined ? null : map(result.rows[0]);
}

export async function loadLearningAiSettings(
  client: PostgresClient,
  tenantId: string,
): Promise<{ readonly aiFeaturesEnabled: boolean }> {
  await requireTenantModuleOperational(client, {
    tenantId,
    moduleKey: 'learning',
  });
  const result = await client.query<{ readonly ai_features_enabled: boolean }>(
    `SELECT ai_features_enabled
       FROM platform.learning_tenant_settings
      WHERE tenant_id = $1::uuid
      LIMIT 1`,
    [tenantId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_SETTINGS_NOT_FOUND');
  return { aiFeaturesEnabled: row.ai_features_enabled };
}

export async function updateLearningAiSettings(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly aiFeaturesEnabled: boolean;
  },
): Promise<{ readonly aiFeaturesEnabled: boolean }> {
  await requireTenantModuleOperational(client, {
    tenantId: input.tenantId,
    moduleKey: 'learning',
  });
  const result = await client.query<{ readonly ai_features_enabled: boolean }>(
    `UPDATE platform.learning_tenant_settings
        SET ai_features_enabled = $2,
            updated_at = now()
      WHERE tenant_id = $1::uuid
      RETURNING ai_features_enabled`,
    [input.tenantId, input.aiFeaturesEnabled],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_SETTINGS_NOT_FOUND');
  return { aiFeaturesEnabled: row.ai_features_enabled };
}

export async function createLearningAiRequest(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly actorIssuer: string | null;
    readonly correlationId: string;
    readonly requestType: LearningAiRequestType;
    readonly prompt: string;
    readonly courseId?: string;
    readonly idempotencyKey: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
): Promise<{ readonly created: boolean; readonly request: LearningAiRequest }> {
  await requireLearningAi(client, input.tenantId);

  const config = TYPE_CONFIG[input.requestType];
  if (config === undefined) throw new Error('LEARNING_AI_REQUEST_TYPE_INVALID');

  const promptText = prompt(input.prompt);
  const idempotency = stableIdempotency(input.idempotencyKey);
  const learnerId =
    input.requestType === 'TUTOR' || input.requestType === 'COACH'
      ? await resolveCallerLearner(client, {
          tenantId: input.tenantId,
          subjectId: input.actorSubjectId,
          subjectIssuer: input.actorIssuer,
        })
      : null;
  const course = await resolveCourseContext(client, {
    tenantId: input.tenantId,
    ...(input.courseId === undefined ? {} : { courseId: input.courseId }),
  });

  const jobId = randomUUID();
  const inputArtifactId = randomUUID();
  const contextArtifactId = course.content === null ? null : randomUUID();

  const registration: AiJobRegistration = {
    jobId,
    intent: {
      invocationId: `learning:${jobId}`,
      tenantId: input.tenantId,
      operation: config.operation,
      purpose: config.purpose,
      inputReference: aiArtifactReference(inputArtifactId),
      ...(contextArtifactId === null
        ? {}
        : { contextReference: aiArtifactReference(contextArtifactId) }),
      promptConfiguration: {
        key: config.promptKey,
        version: config.promptVersion,
      },
      governance: {
        requiredResidencyTags: [],
        requiredComplianceTags: [],
        maximumCostMinorUnits: config.maximumCostMinorUnits,
      },
      idempotencyKey:
        `learning:${input.requestType.toLowerCase()}:${input.actorSubjectId}:${idempotency}`,
      requestedAt: new Date().toISOString(),
    },
    maximumAttempts: 3,
    createdBySubjectId: input.actorSubjectId,
    createdAt: new Date().toISOString(),
    reason: config.purpose,
    correlationId: input.correlationId,
    evidenceRefs: [
      `learning://request-type/${input.requestType.toLowerCase()}`,
      ...(learnerId === null ? [] : [`learning.learner:${learnerId}`]),
      ...(course.courseId === null
        ? []
        : [`learning.course:${course.courseId}`]),
    ],
  };

  const repository = new PostgresAiJobRepository(client);
  const created = await repository.create(registration);
  if (created.status === 'IDEMPOTENCY_CONFLICT') {
    const existing = await findExistingByJob(
      client,
      input.tenantId,
      created.existing.jobId,
    );
    if (existing === null) throw new Error('LEARNING_AI_IDEMPOTENCY_CONFLICT');
    await requireEquivalentReplay(client, {
      tenantId: input.tenantId,
      existing,
      requestType: input.requestType,
      promptText,
      courseId: course.courseId,
    });
    return { created: false, request: existing };
  }

  const effectiveJob = created.job;
  if (created.status === 'ALREADY_COMMITTED') {
    const existing = await findExistingByJob(
      client,
      input.tenantId,
      effectiveJob.jobId,
    );
    if (existing === null) throw new Error('LEARNING_AI_REQUEST_LINK_MISSING');
    await requireEquivalentReplay(client, {
      tenantId: input.tenantId,
      existing,
      requestType: input.requestType,
      promptText,
      courseId: course.courseId,
    });
    return { created: false, request: existing };
  }

  const inputArtifact = await createAiJobArtifact(client, {
    tenantId: input.tenantId,
    jobId,
    artifactId: inputArtifactId,
    artifactType: 'INPUT',
    content: promptText,
    metadata: {
      learningRequestType: input.requestType,
      learnerId,
      courseId: course.courseId,
    },
    createdBySubjectId: input.actorSubjectId,
  });

  const contextArtifact =
    contextArtifactId === null || course.content === null
      ? null
      : await createAiJobArtifact(client, {
          tenantId: input.tenantId,
          jobId,
          artifactId: contextArtifactId,
          artifactType: 'CONTEXT',
          content: course.content,
          mediaType: 'application/json',
          metadata: {
            source: 'learning.course.published',
            courseId: course.courseId,
            courseVersionId: course.courseVersionId,
          },
          createdBySubjectId: input.actorSubjectId,
        });

  const inserted = await client.query<RequestRow>(
    `INSERT INTO platform.learning_ai_requests (
       tenant_id, job_id, request_type, learner_id, course_id,
       course_version_id, requested_by_subject_id, prompt_key,
       prompt_version, input_artifact_id, context_artifact_id,
       correlation_id, metadata
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7,
       $8, $9, $10::uuid, $11::uuid, $12::uuid, $13::jsonb
     )
     RETURNING learning_ai_request_id, tenant_id, job_id, request_type,
               learner_id, course_id, course_version_id,
               requested_by_subject_id, prompt_key, prompt_version,
               input_artifact_id, context_artifact_id, created_at,
               correlation_id, metadata`,
    [
      input.tenantId,
      jobId,
      input.requestType,
      learnerId,
      course.courseId,
      course.courseVersionId,
      input.actorSubjectId,
      config.promptKey,
      config.promptVersion,
      inputArtifact.artifactId,
      contextArtifact?.artifactId ?? null,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('LEARNING_AI_REQUEST_INSERT_FAILED');

  await enqueueAiJob(client, {
    tenantId: input.tenantId,
    jobId,
  });

  return { created: true, request: map(row) };
}

export async function loadLearningAiRequestStatus(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly learningAiRequestId: string;
    readonly actorSubjectId: string;
    readonly actorIssuer: string | null;
    readonly allowAdminRead?: boolean;
    readonly outputResolver?: (input: {
      readonly jobId: string;
      readonly reference: string;
    }) => Promise<{
      readonly mediaType: string;
      readonly content: string;
    } | null>;
  },
): Promise<LearningAiRequestStatus> {
  await requireTenantModuleOperational(client, {
    tenantId: input.tenantId,
    moduleKey: 'learning',
  });
  const result = await client.query<RequestRow>(
    `SELECT learning_ai_request_id, tenant_id, job_id, request_type,
            learner_id, course_id, course_version_id,
            requested_by_subject_id, prompt_key, prompt_version,
            input_artifact_id, context_artifact_id, created_at,
            correlation_id, metadata
       FROM platform.learning_ai_requests
      WHERE tenant_id = $1::uuid
        AND learning_ai_request_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.learningAiRequestId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_AI_REQUEST_NOT_FOUND');

  if (
    !input.allowAdminRead
    && (
      row.request_type === 'TUTOR'
      || row.request_type === 'COACH'
    )
  ) {
    const callerLearnerId = await resolveCallerLearner(client, {
      tenantId: input.tenantId,
      subjectId: input.actorSubjectId,
      subjectIssuer: input.actorIssuer,
    });
    if (row.learner_id !== callerLearnerId) {
      throw new Error('LEARNING_AI_REQUEST_ACCESS_DENIED');
    }
  } else if (
    !input.allowAdminRead
    && row.requested_by_subject_id !== input.actorSubjectId
  ) {
    throw new Error('LEARNING_AI_REQUEST_ACCESS_DENIED');
  }

  const repository = new PostgresAiJobRepository(client);
  const job = await repository.findById({
    tenantId: input.tenantId,
    jobId: row.job_id,
  });
  if (job === null) throw new Error('LEARNING_AI_JOB_NOT_FOUND');
  const events = await repository.listEvents({
    tenantId: input.tenantId,
    jobId: row.job_id,
  });
  const snapshot = replayAiJob(job, events);

  let output: LearningAiRequestStatus['output'] = null;
  if (
    snapshot.status === 'SUCCEEDED'
    && snapshot.outputReference !== undefined
    && input.outputResolver !== undefined
  ) {
    output = await input.outputResolver({
      jobId: row.job_id,
      reference: snapshot.outputReference,
    });
  }

  return {
    ...map(row),
    jobStatus: snapshot.status,
    outputReference: snapshot.outputReference ?? null,
    output,
    confidence: snapshot.confidence ?? null,
    costMinorUnits: snapshot.costMinorUnits ?? null,
    lastFailureCode: snapshot.lastFailureCode ?? null,
  };
}
