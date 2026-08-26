export interface VersionedKnowledgeConfigurationReference {
  readonly key: string;
  readonly version: number;
}

export interface KnowledgeChunkReference {
  readonly ordinal: number;
  readonly chunkReference: string;
  readonly contentReference: string;
  readonly contentDigest: string;
}

export interface KnowledgeIndexRequest {
  readonly ingestionId: string;
  readonly tenantId: string;
  readonly requestedBySubjectId: string;
  readonly purpose: string;
  readonly collectionReference: string;
  readonly documentReference: string;
  readonly documentVersion: number;
  readonly sourceReference: string;
  readonly sourceDigest: string;
  readonly metadataReference: string;
  readonly chunks: readonly KnowledgeChunkReference[];
  readonly embeddingConfiguration:
    VersionedKnowledgeConfigurationReference;
  readonly accessPolicy: VersionedKnowledgeConfigurationReference;
  readonly retentionPolicy: VersionedKnowledgeConfigurationReference;
  readonly retentionExpiresAt: string | null;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface KnowledgeIndexAuthorizationQuery {
  readonly ingestionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly purpose: string;
  readonly collectionReference: string;
  readonly documentReference: string;
  readonly documentVersion: number;
  readonly action: 'knowledge.index';
  readonly accessPolicy:
    VersionedKnowledgeConfigurationReference;
  readonly correlationId: string;
}

export interface KnowledgeIndexAuthorizationDecision {
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly reasonKey: string;
}

export interface KnowledgeIndexAuthorizationPort {
  authorize(
    query: KnowledgeIndexAuthorizationQuery,
  ): Promise<KnowledgeIndexAuthorizationDecision>;
}

export interface KnowledgeIndexProviderInput
extends KnowledgeIndexRequest {
  readonly authorizationDecisionId: string;
}

export interface KnowledgeIndexObservation {
  readonly ingestionId: string;
  readonly tenantId: string;
  readonly collectionReference: string;
  readonly documentReference: string;
  readonly documentVersion: number;
  readonly indexReference: string;
  readonly chunkReferences: readonly string[];
  readonly sourceReferences: readonly string[];
  readonly indexedAt: string;
}

export interface KnowledgeIndexProvider {
  index(
    input: KnowledgeIndexProviderInput,
  ): Promise<KnowledgeIndexObservation>;
}

export interface AuthorizedKnowledgeIndexReceipt {
  readonly authorizationDecisionId: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly observation: KnowledgeIndexObservation;
}

export type KnowledgeIndexErrorCode =
  | 'KNOWLEDGE_INDEX_REQUEST_INVALID'
  | 'KNOWLEDGE_INDEX_CHUNK_SEQUENCE_INVALID'
  | 'KNOWLEDGE_INDEX_CHUNK_DUPLICATE'
  | 'KNOWLEDGE_INDEX_AUTHORIZATION_DECISION_INVALID'
  | 'KNOWLEDGE_INDEX_ACCESS_DENIED'
  | 'KNOWLEDGE_INDEX_OBSERVATION_IDENTITY_MISMATCH'
  | 'KNOWLEDGE_INDEX_OBSERVATION_INVALID';

export class KnowledgeIndexError extends Error {
  readonly code: KnowledgeIndexErrorCode;
  readonly reasonKey: string | undefined;

  constructor(
    code: KnowledgeIndexErrorCode,
    message: string,
    reasonKey?: string,
  ) {
    super(message);
    this.name = 'KnowledgeIndexError';
    this.code = code;
    this.reasonKey = reasonKey;
  }
}

export interface GovernedKnowledgeIndexerDependencies {
  readonly authorization: KnowledgeIndexAuthorizationPort;
  readonly provider: KnowledgeIndexProvider;
}

export class GovernedKnowledgeIndexer {
  private readonly authorization: KnowledgeIndexAuthorizationPort;
  private readonly provider: KnowledgeIndexProvider;

  constructor(dependencies: GovernedKnowledgeIndexerDependencies) {
    this.authorization = dependencies.authorization;
    this.provider = dependencies.provider;
  }

  async index(
    request: KnowledgeIndexRequest,
  ): Promise<AuthorizedKnowledgeIndexReceipt> {
    validateIndexRequest(request);

    const decision = await this.authorization.authorize({
      ingestionId: request.ingestionId,
      tenantId: request.tenantId,
      subjectId: request.requestedBySubjectId,
      purpose: request.purpose,
      collectionReference: request.collectionReference,
      documentReference: request.documentReference,
      documentVersion: request.documentVersion,
      action: 'knowledge.index',
      accessPolicy: request.accessPolicy,
      correlationId: request.correlationId,
    });

    if (
      !nonBlank(decision.decisionId)
      || !nonBlank(decision.reasonKey)
    ) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_AUTHORIZATION_DECISION_INVALID',
        'Knowledge indexing authorization requires stable decision and reason identifiers.',
      );
    }
    if (!decision.allowed) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_ACCESS_DENIED',
        'Knowledge indexing was denied.',
        decision.reasonKey,
      );
    }

    const observation = await this.provider.index({
      ...request,
      authorizationDecisionId: decision.decisionId,
    });
    if (
      observation.ingestionId !== request.ingestionId
      || observation.tenantId !== request.tenantId
      || observation.collectionReference
        !== request.collectionReference
      || observation.documentReference !== request.documentReference
      || observation.documentVersion !== request.documentVersion
    ) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_OBSERVATION_IDENTITY_MISMATCH',
        'The index provider returned output outside the authorized document identity.',
      );
    }

    const expectedChunks = request.chunks.map(
      (chunk) => chunk.chunkReference,
    );
    if (
      !nonBlank(observation.indexReference)
      || !validInstant(observation.indexedAt)
      || observation.sourceReferences.length === 0
      || observation.sourceReferences.some(
        (reference) => !nonBlank(reference),
      )
      || observation.chunkReferences.length
        !== expectedChunks.length
      || observation.chunkReferences.some(
        (reference, index) => reference !== expectedChunks[index],
      )
    ) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_OBSERVATION_INVALID',
        'Index observations require exact ordered chunks, source provenance, index reference, and time.',
      );
    }

    return {
      authorizationDecisionId: decision.decisionId,
      correlationId: request.correlationId,
      evidenceRefs: [...request.evidenceRefs],
      observation,
    };
  }
}

function validateIndexRequest(request: KnowledgeIndexRequest): void {
  if (
    !nonBlank(request.ingestionId)
    || !nonBlank(request.tenantId)
    || !nonBlank(request.requestedBySubjectId)
    || !nonBlank(request.purpose)
    || !nonBlank(request.collectionReference)
    || !nonBlank(request.documentReference)
    || !Number.isInteger(request.documentVersion)
    || request.documentVersion <= 0
    || !nonBlank(request.sourceReference)
    || !validDigest(request.sourceDigest)
    || !nonBlank(request.metadataReference)
    || request.chunks.length === 0
    || !validConfiguration(request.embeddingConfiguration)
    || !validConfiguration(request.accessPolicy)
    || !validConfiguration(request.retentionPolicy)
    || (
      request.retentionExpiresAt !== null
      && (
        !validInstant(request.retentionExpiresAt)
        || Date.parse(request.retentionExpiresAt)
          <= Date.parse(request.requestedAt)
      )
    )
    || !validInstant(request.requestedAt)
    || !nonBlank(request.correlationId)
    || !validEvidence(request.evidenceRefs)
  ) {
    throw new KnowledgeIndexError(
      'KNOWLEDGE_INDEX_REQUEST_INVALID',
      'Knowledge indexing requires governed identity, reference-only source, digest, versioned policies, retention, time, correlation, and evidence.',
    );
  }

  const references = new Set<string>();
  request.chunks.forEach((chunk, index) => {
    if (chunk.ordinal !== index) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_CHUNK_SEQUENCE_INVALID',
        'Knowledge chunks must be contiguous and zero-based.',
      );
    }
    if (
      !nonBlank(chunk.chunkReference)
      || !nonBlank(chunk.contentReference)
      || !validDigest(chunk.contentDigest)
    ) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_REQUEST_INVALID',
        'Knowledge chunks require stable content references and digests.',
      );
    }
    if (references.has(chunk.chunkReference)) {
      throw new KnowledgeIndexError(
        'KNOWLEDGE_INDEX_CHUNK_DUPLICATE',
        'Knowledge chunk references must be unique.',
      );
    }
    references.add(chunk.chunkReference);
  });
}

function validConfiguration(
  reference: VersionedKnowledgeConfigurationReference,
): boolean {
  return nonBlank(reference.key)
    && Number.isInteger(reference.version)
    && reference.version > 0;
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validEvidence(references: readonly string[]): boolean {
  return references.length > 0
    && references.every((reference) => nonBlank(reference));
}

function nonBlank(value: string): boolean {
  return value.trim() !== '';
}

function validInstant(value: string): boolean {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}
