export interface KnowledgeRetrievalQuery {
  readonly queryId: string;
  readonly tenantId: string;
  readonly requesterSubjectId: string;
  readonly requesterAgentId: string | null;
  readonly purpose: string;
  readonly queryReference: string;
  readonly collectionReferences: readonly string[];
  readonly topK: number;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface KnowledgeScopeAuthorizationQuery {
  readonly queryId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string | null;
  readonly purpose: string;
  readonly collectionReferences: readonly string[];
  readonly action: 'knowledge.search';
  readonly correlationId: string;
}

export interface KnowledgeScopeAuthorizationDecision {
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly reasonKey: string;
  readonly filterReference: string | null;
}

export interface KnowledgeScopeAuthorizationPort {
  authorize(
    query: KnowledgeScopeAuthorizationQuery,
  ): Promise<KnowledgeScopeAuthorizationDecision>;
}

export interface KnowledgeProviderQuery {
  readonly queryId: string;
  readonly tenantId: string;
  readonly purpose: string;
  readonly queryReference: string;
  readonly collectionReferences: readonly string[];
  readonly authorizationFilterReference: string;
  readonly topK: number;
  readonly requestedAt: string;
  readonly correlationId: string;
}

export interface KnowledgeCitation {
  readonly documentReference: string;
  readonly documentVersion: number;
  readonly chunkReference: string;
}

export interface KnowledgeRetrievalItem {
  readonly tenantId: string;
  readonly collectionReference: string;
  readonly contentReference: string;
  readonly metadataReference: string;
  readonly score: number;
  readonly citation: KnowledgeCitation;
  readonly indexedAt: string;
  readonly retentionExpiresAt: string | null;
}

export interface KnowledgeRetrievalProvider {
  search(
    query: KnowledgeProviderQuery,
  ): Promise<readonly KnowledgeRetrievalItem[]>;
}

export interface AuthorizedKnowledgeResult {
  readonly queryId: string;
  readonly tenantId: string;
  readonly authorizationDecisionId: string;
  readonly authorizationFilterReference: string;
  readonly purpose: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly items: readonly KnowledgeRetrievalItem[];
  readonly sourceReferences: readonly string[];
}

export type KnowledgeRetrievalErrorCode =
  | 'KNOWLEDGE_QUERY_INVALID'
  | 'KNOWLEDGE_AUTHORIZATION_DECISION_INVALID'
  | 'KNOWLEDGE_ACCESS_DENIED'
  | 'KNOWLEDGE_RESULT_LIMIT_EXCEEDED'
  | 'KNOWLEDGE_RESULT_IDENTITY_MISMATCH'
  | 'KNOWLEDGE_RESULT_DUPLICATE'
  | 'KNOWLEDGE_RESULT_INVALID'
  | 'KNOWLEDGE_RESULT_EXPIRED';

export class KnowledgeRetrievalError extends Error {
  readonly code: KnowledgeRetrievalErrorCode;
  readonly reasonKey: string | undefined;

  constructor(
    code: KnowledgeRetrievalErrorCode,
    message: string,
    reasonKey?: string,
  ) {
    super(message);
    this.name = 'KnowledgeRetrievalError';
    this.code = code;
    this.reasonKey = reasonKey;
  }
}

export interface AuthorizedKnowledgeRetrieverDependencies {
  readonly authorization: KnowledgeScopeAuthorizationPort;
  readonly provider: KnowledgeRetrievalProvider;
}

export class AuthorizedKnowledgeRetriever {
  private readonly authorization: KnowledgeScopeAuthorizationPort;
  private readonly provider: KnowledgeRetrievalProvider;

  constructor(dependencies: AuthorizedKnowledgeRetrieverDependencies) {
    this.authorization = dependencies.authorization;
    this.provider = dependencies.provider;
  }

  async search(
    query: KnowledgeRetrievalQuery,
  ): Promise<AuthorizedKnowledgeResult> {
    validateQuery(query);

    const decision = await this.authorization.authorize({
      queryId: query.queryId,
      tenantId: query.tenantId,
      subjectId: query.requesterSubjectId,
      agentId: query.requesterAgentId,
      purpose: query.purpose,
      collectionReferences: [...query.collectionReferences],
      action: 'knowledge.search',
      correlationId: query.correlationId,
    });

    if (
      !nonBlank(decision.decisionId)
      || !nonBlank(decision.reasonKey)
      || (
        decision.allowed
        && (
          decision.filterReference === null
          || !nonBlank(decision.filterReference)
        )
      )
    ) {
      throw new KnowledgeRetrievalError(
        'KNOWLEDGE_AUTHORIZATION_DECISION_INVALID',
        'Knowledge authorization requires stable decision, reason, and filter references.',
      );
    }
    if (!decision.allowed) {
      throw new KnowledgeRetrievalError(
        'KNOWLEDGE_ACCESS_DENIED',
        'Knowledge search was denied.',
        decision.reasonKey,
      );
    }

    const filterReference = decision.filterReference;
    if (filterReference === null) {
      throw new KnowledgeRetrievalError(
        'KNOWLEDGE_AUTHORIZATION_DECISION_INVALID',
        'Allowed knowledge access requires an authorization filter.',
      );
    }

    const items = await this.provider.search({
      queryId: query.queryId,
      tenantId: query.tenantId,
      purpose: query.purpose,
      queryReference: query.queryReference,
      collectionReferences: [...query.collectionReferences],
      authorizationFilterReference: filterReference,
      topK: query.topK,
      requestedAt: query.requestedAt,
      correlationId: query.correlationId,
    });

    if (items.length > query.topK) {
      throw new KnowledgeRetrievalError(
        'KNOWLEDGE_RESULT_LIMIT_EXCEEDED',
        'The provider returned more knowledge items than authorized.',
      );
    }

    const identities = new Set<string>();
    for (const item of items) {
      if (
        item.tenantId !== query.tenantId
        || !query.collectionReferences.includes(
          item.collectionReference,
        )
      ) {
        throw new KnowledgeRetrievalError(
          'KNOWLEDGE_RESULT_IDENTITY_MISMATCH',
          'Knowledge results must match the authorized tenant and collection.',
        );
      }
      const identity =
        item.citation.documentReference
        + ':' + item.citation.documentVersion
        + ':' + item.citation.chunkReference;
      if (identities.has(identity)) {
        throw new KnowledgeRetrievalError(
          'KNOWLEDGE_RESULT_DUPLICATE',
          'A document version and chunk can appear only once.',
        );
      }
      identities.add(identity);
      validateItem(item);
      if (
        item.retentionExpiresAt !== null
        && Date.parse(item.retentionExpiresAt)
          <= Date.parse(query.requestedAt)
      ) {
        throw new KnowledgeRetrievalError(
          'KNOWLEDGE_RESULT_EXPIRED',
          'Retention-expired knowledge cannot be returned.',
        );
      }
    }

    return {
      queryId: query.queryId,
      tenantId: query.tenantId,
      authorizationDecisionId: decision.decisionId,
      authorizationFilterReference: filterReference,
      purpose: query.purpose,
      correlationId: query.correlationId,
      evidenceRefs: [...query.evidenceRefs],
      items: [...items],
      sourceReferences: [
        ...new Set(
          items.map(
            (item) =>
              item.citation.documentReference
              + '@' + item.citation.documentVersion
              + '#' + item.citation.chunkReference,
          ),
        ),
      ],
    };
  }
}

function validateQuery(query: KnowledgeRetrievalQuery): void {
  if (
    !nonBlank(query.queryId)
    || !nonBlank(query.tenantId)
    || !nonBlank(query.requesterSubjectId)
    || !nonBlank(query.purpose)
    || !nonBlank(query.queryReference)
    || query.collectionReferences.length === 0
    || query.collectionReferences.some(
      (reference) => !nonBlank(reference),
    )
    || new Set(query.collectionReferences).size
      !== query.collectionReferences.length
    || !Number.isInteger(query.topK)
    || query.topK <= 0
    || query.topK > 100
    || !validInstant(query.requestedAt)
    || !nonBlank(query.correlationId)
    || !validEvidence(query.evidenceRefs)
  ) {
    throw new KnowledgeRetrievalError(
      'KNOWLEDGE_QUERY_INVALID',
      'Knowledge queries require governed identity, purpose, reference-only input, bounded collections/results, time, correlation, and evidence.',
    );
  }
}

function validateItem(item: KnowledgeRetrievalItem): void {
  if (
    !nonBlank(item.contentReference)
    || !nonBlank(item.metadataReference)
    || !Number.isFinite(item.score)
    || item.score < 0
    || item.score > 1
    || !nonBlank(item.citation.documentReference)
    || !Number.isInteger(item.citation.documentVersion)
    || item.citation.documentVersion <= 0
    || !nonBlank(item.citation.chunkReference)
    || !validInstant(item.indexedAt)
    || (
      item.retentionExpiresAt !== null
      && !validInstant(item.retentionExpiresAt)
    )
  ) {
    throw new KnowledgeRetrievalError(
      'KNOWLEDGE_RESULT_INVALID',
      'Knowledge items require reference-only content, bounded score, versioned citation, and valid lifecycle time.',
    );
  }
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

export * from './ingestion.ts';
export * from './repository.ts';

export * from './publication-index-request.ts';

export * from './correction-publication-coordinator.ts';
export * from './seed-personas.ts';
