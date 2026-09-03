import { HttpContentAssetScanner, SupabaseContentAssetStore } from '@expadio/storage';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`CONTENT_ASSET_CONFIGURATION_MISSING:${name}`);
  return value;
}

function tags(name: string): readonly string[] {
  return requiredEnv(name).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/**
 * Platform-only composition root. Provider secrets are read exclusively on the
 * Node server and are never serialized into route responses or Brand bundles.
 */
export function configuredContentAssetPolicy(): {
  readonly requiredResidencyTags: readonly string[];
  readonly requiredComplianceTags: readonly string[];
  readonly retentionPolicy: { readonly key: string; readonly version: number };
} {
  const policy = {
    requiredResidencyTags: tags('EXPADIO_CONTENT_ASSET_RESIDENCY_TAGS'),
    requiredComplianceTags: tags('EXPADIO_CONTENT_ASSET_COMPLIANCE_TAGS'),
    retentionPolicy: {
      key: requiredEnv('EXPADIO_CONTENT_ASSET_RETENTION_POLICY_KEY'),
      version: Number(requiredEnv('EXPADIO_CONTENT_ASSET_RETENTION_POLICY_VERSION')),
    },
  };
}

export function createContentAssetBinaryStore(): SupabaseContentAssetStore {
  return new SupabaseContentAssetStore({
    projectUrl: requiredEnv('EXPADIO_CONTENT_ASSET_STORAGE_URL'),
    bucket: requiredEnv('EXPADIO_CONTENT_ASSET_STORAGE_BUCKET'),
    accessToken: async () => requiredEnv('EXPADIO_CONTENT_ASSET_STORAGE_TOKEN'),
    residencyTags: configuredContentAssetPolicy().requiredResidencyTags,
    complianceTags: configuredContentAssetPolicy().requiredComplianceTags,
    signedReadTtlSeconds: 300,
  });
}

export function createContentAssetScanner(): HttpContentAssetScanner {
  return new HttpContentAssetScanner({
    endpoint: requiredEnv('EXPADIO_CONTENT_ASSET_SCANNER_URL'),
    accessToken: async () => requiredEnv('EXPADIO_CONTENT_ASSET_SCANNER_TOKEN'),
  });
}
