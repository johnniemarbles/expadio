import type { PostgresClient } from './index.ts';

export type AiJobArtifactType = 'INPUT' | 'CONTEXT' | 'OUTPUT';

export interface AiJobArtifact {
  readonly artifactId: string;
  readonly tenantId: string;
  readonly jobId: string;
  readonly artifactType: AiJobArtifactType;
  readonly mediaType: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly createdBySubjectId: string;
}

interface ArtifactRow {
  readonly artifact_id: string;
  readonly tenant_id: string;
  readonly job_id: string;
  readonly artifact_type: AiJobArtifactType;
  readonly media_type: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: Date | string;
  readonly created_by_subject_id: string;
}

const REF = /^ai-artifact:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function aiArtifactReference(artifactId: string): string {
  const id = artifactId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('AI_ARTIFACT_ID_INVALID');
  }
  return `ai-artifact://${id}`;
}

export function parseAiArtifactReference(reference: string): string {
  const match = REF.exec(reference.trim());
  const artifactId = match?.[1];
  if (artifactId === undefined) throw new Error('AI_ARTIFACT_REFERENCE_INVALID');
  return artifactId;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function map(row: ArtifactRow): AiJobArtifact {
  return {
    artifactId: row.artifact_id,
    tenantId: row.tenant_id,
    jobId: row.job_id,
    artifactType: row.artifact_type,
    mediaType: row.media_type,
    content: row.content,
    metadata: row.metadata,
    createdAt: iso(row.created_at),
    createdBySubjectId: row.created_by_subject_id,
  };
}

export async function createAiJobArtifact(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly jobId: string;
    readonly artifactType: AiJobArtifactType;
    readonly content: string;
    readonly mediaType?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly createdBySubjectId: string;
    readonly artifactId?: string;
  },
): Promise<AiJobArtifact> {
  if (input.content.trim() === '') throw new Error('AI_ARTIFACT_CONTENT_REQUIRED');
  if (input.createdBySubjectId.trim() === '') throw new Error('AI_ARTIFACT_CREATOR_REQUIRED');

  const result = await client.query<ArtifactRow>(
    `INSERT INTO platform.ai_job_artifacts (
       artifact_id, tenant_id, job_id, artifact_type, media_type,
       content, metadata, created_by_subject_id
     ) VALUES (
       COALESCE($1::uuid, gen_random_uuid()), $2::uuid, $3::uuid, $4, $5,
       $6, $7::jsonb, $8
     )
     RETURNING artifact_id, tenant_id, job_id, artifact_type, media_type,
               content, metadata, created_at, created_by_subject_id`,
    [
      input.artifactId ?? null,
      input.tenantId,
      input.jobId,
      input.artifactType,
      input.mediaType?.trim() || 'text/plain',
      input.content,
      JSON.stringify(input.metadata ?? {}),
      input.createdBySubjectId,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('AI_ARTIFACT_INSERT_FAILED');
  return map(row);
}

export async function loadAiJobArtifact(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly jobId: string;
    readonly reference: string;
    readonly expectedType?: AiJobArtifactType;
  },
): Promise<AiJobArtifact> {
  const artifactId = parseAiArtifactReference(input.reference);
  const result = await client.query<ArtifactRow>(
    `SELECT artifact_id, tenant_id, job_id, artifact_type, media_type,
            content, metadata, created_at, created_by_subject_id
       FROM platform.ai_job_artifacts
      WHERE tenant_id = $1::uuid
        AND job_id = $2::uuid
        AND artifact_id = $3::uuid
      LIMIT 1`,
    [input.tenantId, input.jobId, artifactId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('AI_ARTIFACT_NOT_FOUND');
  if (input.expectedType !== undefined && row.artifact_type !== input.expectedType) {
    throw new Error('AI_ARTIFACT_TYPE_MISMATCH');
  }
  return map(row);
}
