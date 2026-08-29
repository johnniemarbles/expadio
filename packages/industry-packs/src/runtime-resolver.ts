import type {
  IndustryPack,
} from './index.ts';
import type {
  IndustryPackAuthoringScope,
  IndustryPackVersionIdentity,
  IndustryPackVersionSource,
  PinnedIndustryPackVersion,
} from './authoring.ts';

export type IndustryPackRuntimeResolutionReason =
  | 'EXPLICIT_PIN'
  | 'TENANT_PUBLISHED_OVERRIDE'
  | 'PLATFORM_PUBLISHED_DEFAULT';

export interface PublishedIndustryPackSnapshot {
  readonly identity: IndustryPackVersionIdentity;
  readonly scope: IndustryPackAuthoringScope;
  readonly source: IndustryPackVersionSource;
  readonly revision: number;
  readonly definition: IndustryPack;
  readonly publishedAt: string;
  readonly publishedBySubjectId?: string;
}

export interface IndustryPackRuntimeResolutionContext {
  readonly tenantId: string;
  readonly verticalKey: string;
  /**
   * Runtime instances that have already frozen a Pack version resolve this exact
   * scope + identity. A pin never silently falls through to another scope/version.
   */
  readonly pinned?: PinnedIndustryPackVersion;
}

export interface IndustryPackRuntimeResolution {
  readonly snapshot: PublishedIndustryPackSnapshot;
  readonly reason: IndustryPackRuntimeResolutionReason;
  readonly precedenceTrace: readonly string[];
}

/**
 * Read-only persistence boundary used by live runtime.
 *
 * Authoring repositories may expose DRAFT/IN_REVIEW state; this port never does.
 * Implementations must return only persisted PUBLISHED snapshots for unpinned
 * resolution, while exact pins may resolve historical PUBLISHED/SUPERSEDED/
 * ARCHIVED snapshots so existing runtime instances remain reproducible.
 */
export interface IndustryPackRuntimeRepository {
  findPublished(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly verticalKey: string;
  }): Promise<PublishedIndustryPackSnapshot | null>;

  findPinned(
    pinned: PinnedIndustryPackVersion,
  ): Promise<PublishedIndustryPackSnapshot | null>;
}

/**
 * Framework-free runtime resolver boundary.
 *
 * Precedence:
 * 1. exact frozen pin;
 * 2. tenant PUBLISHED override;
 * 3. platform PUBLISHED default;
 * 4. explicit failure — never implicit fallback to the TypeScript registry.
 */
export interface IndustryPackRuntimeResolver {
  resolve(
    context: IndustryPackRuntimeResolutionContext,
  ): Promise<IndustryPackRuntimeResolution>;
}

export class IndustryPackRuntimeResolutionError extends Error {
  readonly code:
    | 'INDUSTRY_PACK_PIN_NOT_FOUND'
    | 'INDUSTRY_PACK_PIN_VERTICAL_MISMATCH'
    | 'INDUSTRY_PACK_PUBLISHED_NOT_FOUND';

  constructor(
    code:
      | 'INDUSTRY_PACK_PIN_NOT_FOUND'
      | 'INDUSTRY_PACK_PIN_VERTICAL_MISMATCH'
      | 'INDUSTRY_PACK_PUBLISHED_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'IndustryPackRuntimeResolutionError';
    this.code = code;
  }
}
