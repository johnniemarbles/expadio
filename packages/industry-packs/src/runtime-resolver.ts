import type { IndustryPack } from './index.ts';

export type IndustryPackRuntimeSource =
  | 'TENANT_PUBLISHED'
  | 'PLATFORM_PUBLISHED'
  | 'CODE_BASELINE'
  | 'NEUTRAL';

export interface IndustryPackRuntimeProvenance {
  readonly verticalKey: string | null;
  readonly version: number | null;
  readonly source: IndustryPackRuntimeSource;
  readonly scope: 'TENANT' | 'PLATFORM' | 'CODE' | 'NONE';
}

export interface IndustryPackRuntimeResolution {
  readonly pack: IndustryPack | null;
  readonly provenance: IndustryPackRuntimeProvenance;
  readonly precedenceTrace: readonly string[];
}

export interface IndustryPackRuntimeResolveInput {
  readonly tenantId: string;
  readonly verticalKey: string | null;
}

/**
 * Resolves the executable Industry Pack for one tenant.
 *
 * Runtime precedence:
 * 1. no tenant vertical binding => neutral engine;
 * 2. tenant PUBLISHED authored version;
 * 3. platform PUBLISHED authored version;
 * 4. registered code baseline;
 * 5. unknown vertical => explicit failure.
 *
 * Draft/IN_REVIEW/SUPERSEDED/ARCHIVED definitions are never executable through
 * this resolver. Persistence and registry lookup remain behind implementations.
 */
export interface IndustryPackRuntimeResolver {
  resolve(input: IndustryPackRuntimeResolveInput): Promise<IndustryPackRuntimeResolution>;
}

export class IndustryPackRuntimeResolutionError extends Error {
  readonly code: 'INDUSTRY_PACK_RUNTIME_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'IndustryPackRuntimeResolutionError';
    this.code = 'INDUSTRY_PACK_RUNTIME_NOT_FOUND';
  }
}
