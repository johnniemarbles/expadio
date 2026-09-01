import type { PoolClient } from 'pg';
import {
  findExecutionArtifactBySource,
} from '@expadio/postgres-runtime/execution-artifact';
import {
  createGovernedSupabaseArtifactStore,
} from './governed-artifact-storage';
import {
  loadArtifactStorageEnvironment,
} from './artifact-storage-config';

const NO_ORGANIZATION_AUTH_CONTEXT =
  '00000000-0000-0000-0000-000000000000';

export async function resolveLearningAiOutput(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly organizationId: string | null;
    readonly jobId: string;
    readonly reference: string;
  },
): Promise<{
  readonly mediaType: string;
  readonly content: string;
} | null> {
  if (!input.reference.startsWith('supabase-storage://')) {
    return null;
  }

  const storage = loadArtifactStorageEnvironment();
  if (storage === null) {
    throw new Error('LEARNING_AI_ARTIFACT_STORAGE_UNAVAILABLE');
  }

  const serviceSubjectId =
    process.env.EXPADIO_AI_WORKER_SUBJECT_ID?.trim() ?? '';
  if (serviceSubjectId === '') {
    throw new Error('LEARNING_AI_ARTIFACT_READER_IDENTITY_DISABLED');
  }

  const artifact = await findExecutionArtifactBySource(client, {
    tenantId: input.tenantId,
    artifactKind: 'AI_TEXT',
    sourceKind: 'AI_INVOCATION',
    sourceId: `ai-job:${input.jobId}`,
  });
  if (
    artifact === null
    || artifact.storageReference !== input.reference
  ) {
    throw new Error('LEARNING_AI_OUTPUT_PROVENANCE_NOT_FOUND');
  }

  const store = await createGovernedSupabaseArtifactStore(client, {
    tenantId: input.tenantId,
    organizationId:
      input.organizationId?.trim()
        ? input.organizationId
        : NO_ORGANIZATION_AUTH_CONTEXT,
    serviceSubjectId,
    correlationId: artifact.correlationId ?? input.jobId,
    projectUrl: storage.projectUrl,
    bucket: storage.bucket,
    requiredResidencyTags: storage.requiredResidencyTags,
    requiredComplianceTags: storage.requiredComplianceTags,
    ...(storage.signedUrlTtlSeconds === undefined
      ? {}
      : { signedUrlTtlSeconds: storage.signedUrlTtlSeconds }),
  });

  const resolved = await store.readText({
    tenantId: input.tenantId,
    reference: input.reference,
    purpose: `learning.ai.output:${input.jobId}`,
    requiredResidencyTags: storage.requiredResidencyTags,
    requiredComplianceTags: storage.requiredComplianceTags,
  });

  return {
    mediaType: artifact.mediaType,
    content: resolved.content,
  };
}
