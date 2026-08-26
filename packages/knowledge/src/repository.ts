import type { KnowledgeIndexRequest } from './ingestion.ts';

export interface KnowledgeIndexManifest {
  readonly request: KnowledgeIndexRequest;
  readonly authorizationDecisionId: string;
  readonly indexReference: string;
  readonly indexedAt: string;
  readonly reason: string;
}

export type CommitKnowledgeIndexManifestResult =
  | {
      readonly status: 'COMMITTED' | 'ALREADY_COMMITTED';
      readonly manifest: KnowledgeIndexManifest;
    }
  | {
      readonly status: 'VERSION_CONFLICT';
      readonly existing: KnowledgeIndexManifest;
    };

export interface KnowledgeIndexManifestRepository {
  commit(
    manifest: KnowledgeIndexManifest,
  ): Promise<CommitKnowledgeIndexManifestResult>;
  load(input: {
    readonly tenantId: string;
    readonly documentReference: string;
    readonly documentVersion: number;
  }): Promise<KnowledgeIndexManifest | undefined>;
}
