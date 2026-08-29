import type { IndustryPack } from './index.ts';
import { findIndustryPack } from './index.ts';
import type { IndustryPackVersion, PinnedIndustryPackVersion } from './authoring.ts';

export type IndustryPackRuntimeSource =
  | 'TENANT_AUTHORED'
  | 'PLATFORM_AUTHORED'
  | 'CODE_BASELINE'
  | 'NONE';

/**
 * Read-side port that returns the winning published authored version for a
 * tenant/family. Implementations own TENANT -> PLATFORM precedence.
 */
export interface PublishedIndustryPackReader {
  findPublished(input: {
    readonly tenantId: string;
    readonly verticalKey: string;
  }): Promise<IndustryPackVersion | null>;
}

export interface ResolvedIndustryPack {
  readonly pack: IndustryPack | null;
  readonly source: IndustryPackRuntimeSource;
  readonly pin?: PinnedIndustryPackVersion;
}

/**
 * Runtime resolution keeps authored configuration ahead of the code baseline,
 * while preserving the code registry as a safe fallback during migration.
 */
export async function resolveIndustryPackRuntime(input: {
  readonly tenantId: string;
  readonly verticalKey: string | null | undefined;
  readonly publishedReader: PublishedIndustryPackReader;
}): Promise<ResolvedIndustryPack> {
  const key = input.verticalKey?.trim().toLowerCase();
  if (!key) return { pack: null, source: 'NONE' };

  const authored = await input.publishedReader.findPublished({
    tenantId: input.tenantId,
    verticalKey: key,
  });

  if (authored !== null) {
    if (authored.state !== 'PUBLISHED') {
      throw new Error('INDUSTRY_PACK_RUNTIME_READER_RETURNED_NON_PUBLISHED');
    }
    return {
      pack: authored.definition,
      source: authored.scope.type === 'TENANT' ? 'TENANT_AUTHORED' : 'PLATFORM_AUTHORED',
      pin: {
        verticalKey: authored.identity.verticalKey,
        version: authored.identity.version,
        scope: authored.scope,
      },
    };
  }

  const code = findIndustryPack(key);
  return code === null
    ? { pack: null, source: 'NONE' }
    : { pack: code, source: 'CODE_BASELINE' };
}
