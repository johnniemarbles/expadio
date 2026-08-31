import type {
  AiJobCreateResult,
  AiJobEvent,
  AiJobEventAppendResult,
  AiJobRegistration,
  AiJobRepository,
  AiOperation,
} from '@expadio/ai-gateway';
import type { PostgresClient } from './index.ts';

interface JobRow {
  readonly job_id: string;
  readonly tenant_id: string;
  readonly invocation_id: string;
  readonly operation: AiOperation;
  readonly purpose: string;
  readonly input_reference: string;
  readonly context_reference: string | null;
  readonly prompt_configuration_key: string;
  readonly prompt_configuration_version: number;
  readonly required_residency_tags: readonly string[];
  readonly required_compliance_tags: readonly string[];
  readonly maximum_cost_minor_units: number | null;
  readonly maximum_attempts: number;
  readonly idempotency_key: string;
  readonly requested_at: Date | string;
  readonly created_by_subject_id: string;
  readonly created_at: Date | string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

interface EventRow {
  readonly event_id: string;
  readonly job_id: string;
  readonly tenant_id: string;
  readonly sequence: number;
  readonly event_type: AiJobEvent['type'];
  readonly occurred_at: Date | string;
  readonly actor_subject_id: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
  readonly output_reference: string | null;
  readonly confidence: number | null;
  readonly cost_minor_units: number | null;
  readonly failure_code: string | null;
  readonly next_attempt_at: Date | string | null;
}

interface SequenceRow {
  readonly expected_sequence: number;
}

/** PostgreSQL adapter for immutable AI registrations and append-only events. */
export class PostgresAiJobRepository implements AiJobRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async create(job: AiJobRegistration): Promise<AiJobCreateResult> {
    const result = await this.#client.query(
      `INSERT INTO platform.ai_jobs (
         job_id, tenant_id, invocation_id, operation, purpose,
         input_reference, context_reference,
         prompt_configuration_key, prompt_configuration_version,
         required_residency_tags, required_compliance_tags,
         maximum_cost_minor_units, maximum_attempts, idempotency_key,
         requested_at, created_by_subject_id, created_at, reason,
         correlation_id, evidence_refs
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9,
         $10::text[], $11::text[], $12, $13, $14, $15::timestamptz,
         $16, $17::timestamptz, $18, $19::uuid, $20::text[]
       )
       ON CONFLICT DO NOTHING`,
      jobValues(job),
    );
    if (result.rowCount === 1) return { status: 'COMMITTED', job };

    const existing = await this.findConflict(job);
    if (existing === null) {
      throw new Error('AI_JOB_CONFLICT_WITHOUT_VISIBLE_REGISTRATION');
    }
    return same(existing, job)
      ? { status: 'ALREADY_COMMITTED', job: existing }
      : { status: 'IDEMPOTENCY_CONFLICT', existing };
  }

  async findById(input: {
    readonly tenantId: string;
    readonly jobId: string;
  }): Promise<AiJobRegistration | null> {
    const result = await this.#client.query<JobRow>(
      `${JOB_SELECT}
        WHERE tenant_id = $1::uuid
          AND job_id = $2::uuid
        LIMIT 1`,
      [input.tenantId, input.jobId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapJob(row);
  }

  async listEvents(input: {
    readonly tenantId: string;
    readonly jobId: string;
  }): Promise<readonly AiJobEvent[]> {
    const result = await this.#client.query<EventRow>(
      `SELECT event_id, job_id, tenant_id, sequence, event_type,
              occurred_at, actor_subject_id, reason, correlation_id,
              evidence_refs, output_reference, confidence,
              cost_minor_units, failure_code, next_attempt_at
         FROM platform.ai_job_events
        WHERE tenant_id = $1::uuid
          AND job_id = $2::uuid
        ORDER BY sequence ASC`,
      [input.tenantId, input.jobId],
    );
    return result.rows.map(mapEvent);
  }

  async appendEvent(event: AiJobEvent): Promise<AiJobEventAppendResult> {
    const existing = await this.findEvent(event.tenantId, event.eventId);
    if (existing !== null) {
      if (!same(existing, event)) {
        throw new Error('AI_JOB_EVENT_ID_CONFLICT');
      }
      return { status: 'ALREADY_COMMITTED', event: existing };
    }

    try {
      const result = await this.#client.query(
        `INSERT INTO platform.ai_job_events (
           event_id, job_id, tenant_id, sequence, event_type, occurred_at,
           actor_subject_id, reason, correlation_id, evidence_refs,
           output_reference, confidence, cost_minor_units, failure_code,
           next_attempt_at
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::timestamptz,
           $7, $8, $9::uuid, $10::text[], $11, $12, $13, $14,
           $15::timestamptz
         )`,
        eventValues(event),
      );
      if (result.rowCount === 1) {
        return { status: 'COMMITTED', event };
      }
    } catch (error) {
      if (!sequenceConflict(error) && postgresErrorCode(error) !== '23505') {
        throw error;
      }
      const concurrent = await this.findEvent(event.tenantId, event.eventId);
      if (concurrent !== null && same(concurrent, event)) {
        return { status: 'ALREADY_COMMITTED', event: concurrent };
      }
      return {
        status: 'SEQUENCE_CONFLICT',
        expectedSequence: await this.expectedSequence(
          event.tenantId,
          event.jobId,
        ),
      };
    }

    throw new Error('AI_JOB_EVENT_INSERT_DID_NOT_COMMIT');
  }

  private async findConflict(
    job: AiJobRegistration,
  ): Promise<AiJobRegistration | null> {
    const result = await this.#client.query<JobRow>(
      `${JOB_SELECT}
        WHERE tenant_id = $1::uuid
          AND (
            job_id = $2::uuid
            OR invocation_id = $3
            OR idempotency_key = $4
          )
        ORDER BY created_at ASC
        LIMIT 1`,
      [
        job.intent.tenantId,
        job.jobId,
        job.intent.invocationId,
        job.intent.idempotencyKey,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapJob(row);
  }

  private async findEvent(
    tenantId: string,
    eventId: string,
  ): Promise<AiJobEvent | null> {
    const result = await this.#client.query<EventRow>(
      `SELECT event_id, job_id, tenant_id, sequence, event_type,
              occurred_at, actor_subject_id, reason, correlation_id,
              evidence_refs, output_reference, confidence,
              cost_minor_units, failure_code, next_attempt_at
         FROM platform.ai_job_events
        WHERE tenant_id = $1::uuid
          AND event_id = $2::uuid
        LIMIT 1`,
      [tenantId, eventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEvent(row);
  }

  private async expectedSequence(
    tenantId: string,
    jobId: string,
  ): Promise<number> {
    const result = await this.#client.query<SequenceRow>(
      `SELECT COALESCE(max(sequence), 0)::integer + 1 AS expected_sequence
         FROM platform.ai_job_events
        WHERE tenant_id = $1::uuid
          AND job_id = $2::uuid`,
      [tenantId, jobId],
    );
    return result.rows[0]?.expected_sequence ?? 1;
  }
}

const JOB_SELECT = `SELECT job_id, tenant_id, invocation_id, operation, purpose,
       input_reference, context_reference, prompt_configuration_key,
       prompt_configuration_version, required_residency_tags,
       required_compliance_tags, maximum_cost_minor_units, maximum_attempts,
       idempotency_key, requested_at, created_by_subject_id, created_at,
       reason, correlation_id, evidence_refs
  FROM platform.ai_jobs`;

function jobValues(job: AiJobRegistration): readonly unknown[] {
  return [
    job.jobId,
    job.intent.tenantId,
    job.intent.invocationId,
    job.intent.operation,
    job.intent.purpose,
    job.intent.inputReference,
    job.intent.contextReference ?? null,
    job.intent.promptConfiguration.key,
    job.intent.promptConfiguration.version,
    [...job.intent.governance.requiredResidencyTags],
    [...job.intent.governance.requiredComplianceTags],
    job.intent.governance.maximumCostMinorUnits ?? null,
    job.maximumAttempts,
    job.intent.idempotencyKey,
    job.intent.requestedAt,
    job.createdBySubjectId,
    job.createdAt,
    job.reason,
    job.correlationId,
    [...job.evidenceRefs],
  ];
}

function eventValues(event: AiJobEvent): readonly unknown[] {
  return [
    event.eventId,
    event.jobId,
    event.tenantId,
    event.sequence,
    event.type,
    event.occurredAt,
    event.actorSubjectId,
    event.reason,
    event.correlationId,
    [...event.evidenceRefs],
    event.type === 'SUCCEEDED' ? event.outputReference : null,
    event.type === 'SUCCEEDED' ? event.confidence ?? null : null,
    event.type === 'SUCCEEDED' ? event.costMinorUnits ?? null : null,
    event.type === 'FAILED' ? event.failureCode : null,
    event.type === 'RETRY_SCHEDULED' ? event.nextAttemptAt : null,
  ];
}

function mapJob(row: JobRow): AiJobRegistration {
  return {
    jobId: row.job_id,
    intent: {
      invocationId: row.invocation_id,
      tenantId: row.tenant_id,
      operation: row.operation,
      purpose: row.purpose,
      inputReference: row.input_reference,
      ...(row.context_reference === null
        ? {}
        : { contextReference: row.context_reference }),
      promptConfiguration: {
        key: row.prompt_configuration_key,
        version: row.prompt_configuration_version,
      },
      governance: {
        requiredResidencyTags: [...row.required_residency_tags],
        requiredComplianceTags: [...row.required_compliance_tags],
        ...(row.maximum_cost_minor_units === null
          ? {}
          : { maximumCostMinorUnits: row.maximum_cost_minor_units }),
      },
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      requestedAt: iso(row.requested_at),
    },
    maximumAttempts: row.maximum_attempts,
    createdBySubjectId: row.created_by_subject_id,
    createdAt: iso(row.created_at),
    reason: row.reason,
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
  };
}

function mapEvent(row: EventRow): AiJobEvent {
  const common = {
    eventId: row.event_id,
    jobId: row.job_id,
    tenantId: row.tenant_id,
    sequence: row.sequence,
    occurredAt: iso(row.occurred_at),
    actorSubjectId: row.actor_subject_id,
    reason: row.reason,
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
  };
  switch (row.event_type) {
    case 'STARTED':
    case 'CANCELLED':
      return { ...common, type: row.event_type };
    case 'SUCCEEDED':
      return {
        ...common,
        type: row.event_type,
        outputReference: row.output_reference!,
        ...(row.confidence === null ? {} : { confidence: row.confidence }),
        ...(row.cost_minor_units === null
          ? {}
          : { costMinorUnits: row.cost_minor_units }),
      };
    case 'FAILED':
      return {
        ...common,
        type: row.event_type,
        failureCode: row.failure_code!,
      };
    case 'RETRY_SCHEDULED':
      return {
        ...common,
        type: row.event_type,
        nextAttemptAt: iso(row.next_attempt_at!),
      };
  }
}

function sequenceConflict(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith('AI job event sequence must be ');
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
