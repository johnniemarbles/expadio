import type {
  CommitKnowledgeIndexManifestResult,
  KnowledgeChunkReference,
  KnowledgeIndexManifest,
  KnowledgeIndexManifestRepository,
} from '@expadio/knowledge';
import type { PostgresClient } from './index.ts';

interface DocumentRow {
  readonly tenant_id: string;
  readonly ingestion_id: string;
  readonly purpose: string;
  readonly requested_at: Date | string;
  readonly collection_reference: string;
  readonly document_reference: string;
  readonly document_version: number;
  readonly source_reference: string;
  readonly source_digest: string;
  readonly metadata_reference: string;
  readonly embedding_configuration_key: string;
  readonly embedding_configuration_version: number;
  readonly access_policy_key: string;
  readonly access_policy_version: number;
  readonly retention_policy_key: string;
  readonly retention_policy_version: number;
  readonly retention_expires_at: Date | string | null;
  readonly authorization_decision_id: string;
  readonly index_reference: string;
  readonly indexed_at: Date | string;
  readonly indexed_by_subject_id: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

interface ChunkRow {
  readonly ordinal: number;
  readonly chunk_reference: string;
  readonly content_reference: string;
  readonly content_digest: string;
}

/**
 * Transaction-bound PostgreSQL adapter. The caller supplies a request
 * transaction so document and chunk inserts commit or roll back together.
 */
export class PostgresKnowledgeIndexManifestRepository
implements KnowledgeIndexManifestRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async commit(
    manifest: KnowledgeIndexManifest,
  ): Promise<CommitKnowledgeIndexManifestResult> {
    const request = manifest.request;
    const result = await this.#client.query(
      `INSERT INTO platform.knowledge_documents (
         tenant_id, ingestion_id, purpose, requested_at,
         collection_reference, document_reference, document_version,
         source_reference, source_digest, metadata_reference,
         embedding_configuration_key, embedding_configuration_version,
         access_policy_key, access_policy_version,
         retention_policy_key, retention_policy_version,
         retention_expires_at, authorization_decision_id,
         index_reference, indexed_at, indexed_by_subject_id, reason,
         correlation_id, evidence_refs
       ) VALUES (
         $1::uuid, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16, $17::timestamptz,
         $18, $19, $20::timestamptz, $21, $22, $23::uuid,
         $24::text[]
       )
       ON CONFLICT DO NOTHING`,
      documentValues(manifest),
    );

    if (result.rowCount === 1) {
      await this.#client.query(
        `INSERT INTO platform.knowledge_chunks (
           tenant_id, document_reference, document_version,
           ordinal, chunk_reference, content_reference, content_digest
         )
         SELECT $1::uuid, $2, $3, chunk.ordinal,
                chunk.chunk_reference, chunk.content_reference,
                chunk.content_digest
           FROM jsonb_to_recordset($4::jsonb) AS chunk(
             ordinal integer,
             chunk_reference text,
             content_reference text,
             content_digest text
           )`,
        [
          request.tenantId,
          request.documentReference,
          request.documentVersion,
          JSON.stringify(request.chunks.map((chunk) => ({
            ordinal: chunk.ordinal,
            chunk_reference: chunk.chunkReference,
            content_reference: chunk.contentReference,
            content_digest: chunk.contentDigest,
          }))),
        ],
      );
      return { status: 'COMMITTED', manifest };
    }

    const existing = await this.load({
      tenantId: request.tenantId,
      documentReference: request.documentReference,
      documentVersion: request.documentVersion,
    });
    if (existing === undefined) {
      throw new Error(
        'KNOWLEDGE_INDEX_CONFLICT_WITHOUT_VISIBLE_MANIFEST',
      );
    }
    return same(existing, manifest)
      ? { status: 'ALREADY_COMMITTED', manifest: existing }
      : { status: 'VERSION_CONFLICT', existing };
  }

  async load(input: {
    readonly tenantId: string;
    readonly documentReference: string;
    readonly documentVersion: number;
  }): Promise<KnowledgeIndexManifest | undefined> {
    const documentResult = await this.#client.query<DocumentRow>(
      DOCUMENT_SELECT
        + ` WHERE tenant_id = $1::uuid
              AND document_reference = $2
              AND document_version = $3
             LIMIT 1`,
      [
        input.tenantId,
        input.documentReference,
        input.documentVersion,
      ],
    );
    const document = documentResult.rows[0];
    if (document === undefined) return undefined;

    const chunks = await this.#client.query<ChunkRow>(
      `SELECT ordinal, chunk_reference,
              content_reference, content_digest
         FROM platform.knowledge_chunks
        WHERE tenant_id = $1::uuid
          AND document_reference = $2
          AND document_version = $3
        ORDER BY ordinal ASC`,
      [
        input.tenantId,
        input.documentReference,
        input.documentVersion,
      ],
    );
    return mapManifest(document, chunks.rows);
  }
}

const DOCUMENT_SELECT =
  `SELECT tenant_id, ingestion_id, purpose, requested_at,
          collection_reference, document_reference, document_version,
          source_reference, source_digest, metadata_reference,
          embedding_configuration_key, embedding_configuration_version,
          access_policy_key, access_policy_version,
          retention_policy_key, retention_policy_version,
          retention_expires_at, authorization_decision_id,
          index_reference, indexed_at, indexed_by_subject_id, reason,
          correlation_id, evidence_refs
     FROM platform.knowledge_documents`;

function documentValues(
  manifest: KnowledgeIndexManifest,
): readonly unknown[] {
  const request = manifest.request;
  return [
    request.tenantId,
    request.ingestionId,
    request.purpose,
    request.requestedAt,
    request.collectionReference,
    request.documentReference,
    request.documentVersion,
    request.sourceReference,
    request.sourceDigest,
    request.metadataReference,
    request.embeddingConfiguration.key,
    request.embeddingConfiguration.version,
    request.accessPolicy.key,
    request.accessPolicy.version,
    request.retentionPolicy.key,
    request.retentionPolicy.version,
    request.retentionExpiresAt,
    manifest.authorizationDecisionId,
    manifest.indexReference,
    manifest.indexedAt,
    request.requestedBySubjectId,
    manifest.reason,
    request.correlationId,
    [...request.evidenceRefs],
  ];
}

function mapManifest(
  row: DocumentRow,
  chunks: readonly ChunkRow[],
): KnowledgeIndexManifest {
  return {
    request: {
      ingestionId: row.ingestion_id,
      tenantId: row.tenant_id,
      requestedBySubjectId: row.indexed_by_subject_id,
      purpose: row.purpose,
      collectionReference: row.collection_reference,
      documentReference: row.document_reference,
      documentVersion: row.document_version,
      sourceReference: row.source_reference,
      sourceDigest: row.source_digest,
      metadataReference: row.metadata_reference,
      chunks: chunks.map(mapChunk),
      embeddingConfiguration: {
        key: row.embedding_configuration_key,
        version: row.embedding_configuration_version,
      },
      accessPolicy: {
        key: row.access_policy_key,
        version: row.access_policy_version,
      },
      retentionPolicy: {
        key: row.retention_policy_key,
        version: row.retention_policy_version,
      },
      retentionExpiresAt:
        row.retention_expires_at === null
          ? null
          : iso(row.retention_expires_at),
      requestedAt: iso(row.requested_at),
      correlationId: row.correlation_id,
      evidenceRefs: [...row.evidence_refs],
    },
    authorizationDecisionId: row.authorization_decision_id,
    indexReference: row.index_reference,
    indexedAt: iso(row.indexed_at),
    reason: row.reason,
  };
}

function mapChunk(row: ChunkRow): KnowledgeChunkReference {
  return {
    ordinal: row.ordinal,
    chunkReference: row.chunk_reference,
    contentReference: row.content_reference,
    contentDigest: row.content_digest,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
