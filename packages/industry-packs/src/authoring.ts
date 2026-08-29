import type { IndustryPack } from './index.ts';

/**
 * Stable identity for one authored Industry Pack version.
 *
 * `verticalKey` identifies the pack family. `version` identifies an immutable
 * published definition within that family. Draft edits use `revision` for
 * optimistic concurrency and do not create hidden semantic versions.
 */
export interface IndustryPackVersionIdentity {
  readonly verticalKey: string;
  readonly version: number;
}

export type IndustryPackAuthoringScope =
  | { readonly type: 'PLATFORM' }
  | { readonly type: 'TENANT'; readonly tenantId: string };

export type IndustryPackVersionState =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'ARCHIVED';

export type IndustryPackVersionSource =
  | 'CODE_BASELINE'
  | 'PLATFORM_AUTHORED'
  | 'TENANT_AUTHORED';

/**
 * Versioned control-plane artifact.
 *
 * PUBLISHED/SUPERSEDED/ARCHIVED definitions are historical snapshots and must
 * never be edited in place. A later lifecycle service will enforce transitions;
 * this type only freezes the persistence/API contract.
 */
export interface IndustryPackVersion {
  readonly identity: IndustryPackVersionIdentity;
  readonly scope: IndustryPackAuthoringScope;
  readonly source: IndustryPackVersionSource;
  readonly state: IndustryPackVersionState;
  readonly definition: IndustryPack;

  /**
   * Mutable-draft concurrency token. Starts at 1 and increments for each accepted
   * draft edit. Publication freezes the current revision into `identity.version`.
   */
  readonly revision: number;

  /** Optional lineage to the version this artifact was derived from. */
  readonly parent?: IndustryPackVersionIdentity;

  readonly createdBySubjectId: string;
  readonly createdAt: string;
  readonly updatedBySubjectId: string;
  readonly updatedAt: string;

  readonly submittedBySubjectId?: string;
  readonly submittedAt?: string;
  readonly publishedBySubjectId?: string;
  readonly publishedAt?: string;
}

/**
 * Exact pack version selected by runtime/configuration.
 *
 * The scope is part of the reference so a tenant-authored pack cannot be
 * silently confused with a platform pack sharing the same key/version.
 */
export interface PinnedIndustryPackVersion extends IndustryPackVersionIdentity {
  readonly scope: IndustryPackAuthoringScope;
}

/** Input for creating a new authoring draft. */
export interface CreateIndustryPackDraft {
  readonly scope: IndustryPackAuthoringScope;
  readonly verticalKey: string;
  readonly definition: IndustryPack;
  readonly createdBySubjectId: string;
  readonly parent?: IndustryPackVersionIdentity;
}

/** Optimistic-concurrency edit command for an existing DRAFT artifact. */
export interface UpdateIndustryPackDraft {
  readonly identity: IndustryPackVersionIdentity;
  readonly scope: IndustryPackAuthoringScope;
  readonly expectedRevision: number;
  readonly definition: IndustryPack;
  readonly updatedBySubjectId: string;
}
