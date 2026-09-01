export interface ArtifactStorageEnvironment {
  readonly projectUrl: string;
  readonly bucket: string;
  readonly requiredResidencyTags: readonly string[];
  readonly requiredComplianceTags: readonly string[];
  readonly signedUrlTtlSeconds?: number;
}

function tags(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return [];
  return [...new Set(
    value.split(',').map((entry) => entry.trim()).filter(Boolean),
  )];
}

export function loadArtifactStorageEnvironment():
ArtifactStorageEnvironment | null {
  const projectUrl =
    process.env.EXPADIO_ARTIFACT_SUPABASE_URL?.trim() ?? '';
  const bucket =
    process.env.EXPADIO_ARTIFACT_SUPABASE_BUCKET?.trim() ?? '';
  if (projectUrl === '' || bucket === '') return null;

  const ttlRaw =
    process.env.EXPADIO_ARTIFACT_SIGNED_URL_TTL_SECONDS?.trim();
  const ttl =
    ttlRaw === undefined || ttlRaw === ''
      ? undefined
      : Number(ttlRaw);
  if (
    ttl !== undefined
    && (!Number.isInteger(ttl) || ttl < 30 || ttl > 900)
  ) {
    throw new Error('ARTIFACT_STORAGE_SIGNED_URL_TTL_INVALID');
  }

  return {
    projectUrl,
    bucket,
    requiredResidencyTags:
      tags(process.env.EXPADIO_ARTIFACT_RESIDENCY_TAGS),
    requiredComplianceTags:
      tags(process.env.EXPADIO_ARTIFACT_COMPLIANCE_TAGS),
    ...(ttl === undefined ? {} : { signedUrlTtlSeconds: ttl }),
  };
}
