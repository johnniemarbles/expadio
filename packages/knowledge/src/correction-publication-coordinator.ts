import type {
  BusinessConfigurationPublishRequest,
  BusinessConfigurationPublishResult,
  BusinessConfigurationPublishService,
} from '@expadio/business-config';
import type {
  AuthorizedKnowledgeIndexReceipt,
  GovernedKnowledgeIndexer,
} from './ingestion.ts';
import {
  prepareCorrectionPublicationIndexRequests,
  type CorrectionPublicationIndexInput,
} from './publication-index-request.ts';

export type CorrectionPublicationCoordinationResult =
  | {
      readonly status: 'PUBLISHED_AND_INDEXED' | 'ALREADY_PUBLISHED_AND_INDEXED';
      readonly publicationStatus: 'PUBLISHED' | 'ALREADY_PUBLISHED';
      readonly receipts: readonly AuthorizedKnowledgeIndexReceipt[];
    }
  | Extract<BusinessConfigurationPublishResult, { readonly status: 'DENIED' | 'CONFLICT' }>;

export class CorrectionPublicationCoordinator {
  readonly #publisher: BusinessConfigurationPublishService;
  readonly #indexer: Pick<GovernedKnowledgeIndexer, 'index'>;

  constructor(input: {
    readonly publisher: BusinessConfigurationPublishService;
    readonly indexer: Pick<GovernedKnowledgeIndexer, 'index'>;
  }) {
    this.#publisher = input.publisher;
    this.#indexer = input.indexer;
  }

  async publishAndIndex(
    request: BusinessConfigurationPublishRequest,
    indexInput: CorrectionPublicationIndexInput,
  ): Promise<CorrectionPublicationCoordinationResult> {
    const published = await this.#publisher.publish(request);
    if (published.status === 'DENIED' || published.status === 'CONFLICT') {
      return published;
    }

    const indexRequests = prepareCorrectionPublicationIndexRequests(
      published.publication,
      indexInput,
    );
    const receipts: AuthorizedKnowledgeIndexReceipt[] = [];
    for (const indexRequest of indexRequests) {
      receipts.push(await this.#indexer.index(indexRequest));
    }
    return {
      status: published.status === 'PUBLISHED'
        ? 'PUBLISHED_AND_INDEXED'
        : 'ALREADY_PUBLISHED_AND_INDEXED',
      publicationStatus: published.status,
      receipts,
    };
  }
}
