import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  GeminiAiAdapter,
  OpenAiAiAdapter,
  RoutedAiGateway,
  aiCapabilityKey,
  governedAiApiTokenProvider,
  replayAiJob,
  type AiJobEvent,
  type AiProviderAdapter,
} from '@expadio/ai-gateway';
import {
  loadAiJobArtifact,
} from '@expadio/postgres-runtime/ai-artifact';
import {
  findExecutionArtifactBySource,
} from '@expadio/postgres-runtime/execution-artifact';
import {
  PostgresIndexedDurableArtifactSink,
} from '@expadio/postgres-runtime/indexed-artifact-sink';
import {
  claimAiJobExecution,
  completeAiJobExecution,
  failAiJobExecution,
  type AiExecutionClaim,
} from '@expadio/postgres-runtime/ai-execution-queue';
import { PostgresAiJobRepository } from '@expadio/postgres-runtime/ai-job';
import { PostgresIntelligenceUsageRepository } from '@expadio/postgres-runtime/intelligence-usage';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import type { SecretResolver } from '@expadio/provider-registry/repository';
import { delegatedSecretResolver } from './vault-secret-resolver';
import {
  createGovernedSupabaseArtifactStore,
} from './governed-artifact-storage';

const NO_ORGANIZATION_AUTH_CONTEXT =
  '00000000-0000-0000-0000-000000000000';

export type AiJobWorkerResult =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'SUCCEEDED';
      readonly jobId: string;
      readonly outputReference: string;
      readonly connectorKey: string;
      readonly providerKey: string;
      readonly modelKey: string;
      readonly costMinorUnits: number;
    }
  | {
      readonly status: 'RETRY_SCHEDULED' | 'DEAD' | 'STALE_CLAIM';
      readonly jobId: string;
      readonly reasonCode: string;
    }
  | {
      readonly status: 'ALREADY_TERMINAL';
      readonly jobId: string;
    };

export interface AiJobWorkerOptions {
  readonly serviceSubjectId: string;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly secretResolver?: SecretResolver;
  readonly leaseMs?: number;
  readonly artifactStorage?: {
    readonly projectUrl: string;
    readonly bucket: string;
    readonly requiredResidencyTags?: readonly string[];
    readonly requiredComplianceTags?: readonly string[];
    readonly signedUrlTtlSeconds?: number;
  };
}

function stableServiceSubject(value: string): string {
  const normalized = value.trim();
  if (normalized === '' || /[\r\n\t]/u.test(normalized)) {
    throw new Error('AI_WORKER_SERVICE_SUBJECT_INVALID');
  }
  return normalized;
}

function adapterKind(connector: {
  readonly providerType: string;
  readonly providerKey: string;
}): 'openai' | 'gemini' | null {
  const value =
    `${connector.providerType}:${connector.providerKey}`.toLowerCase();
  if (value.includes('openai')) return 'openai';
  if (value.includes('gemini') || value.includes('google-ai')) return 'gemini';
  return null;
}

function nextSequence(events: readonly AiJobEvent[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}

const DURABLE_TEXT_OPERATIONS = new Set([
  'GENERATE',
  'CLASSIFY',
  'SUMMARIZE',
  'EXTRACT',
  'TRANSLATE',
]);

async function reconcileUsageFromOutputArtifact(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly jobId: string;
    readonly correlationId: string;
    readonly outputReference: string;
    readonly occurredAt: string;
  },
): Promise<void> {
  const artifact = await findExecutionArtifactBySource(client, {
    tenantId: input.tenantId,
    artifactKind: 'AI_TEXT',
    sourceKind: 'AI_INVOCATION',
    sourceId: `ai-job:${input.jobId}`,
  });
  if (
    artifact === null
    || artifact.storageReference !== input.outputReference
  ) {
    throw new Error('AI_OUTPUT_PROVENANCE_INCOMPLETE');
  }

  await new PostgresIntelligenceUsageRepository(client).record({
    eventId: input.jobId,
    tenantId: input.tenantId,
    organizationId: null,
    meter: 'AI_REQUEST',
    quantity: 1,
    costMinorUnits: artifact.costMinorUnits,
    currency: 'USD',
    capabilityKey: artifact.capabilityKey,
    connectorKey: artifact.connectorKey,
    providerKey: artifact.providerKey,
    modelKey: artifact.modelKey ?? 'unknown',
    providerCostOwnership: artifact.providerCostOwnership,
    workReference: `ai-job:${input.jobId}`,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    correlationId: input.correlationId,
    evidenceRefs: [
      `ai-job:${input.jobId}`,
      input.outputReference,
      `execution-artifact:${artifact.artifactId}`,
    ],
  });
}

async function append(
  repository: PostgresAiJobRepository,
  event: AiJobEvent,
): Promise<void> {
  const result = await repository.appendEvent(event);
  if (
    result.status !== 'COMMITTED'
    && result.status !== 'ALREADY_COMMITTED'
  ) {
    throw new Error(
      `AI_JOB_EVENT_SEQUENCE_CONFLICT:expected=${result.expectedSequence}`,
    );
  }
}

async function retryOrDead(
  client: PoolClient,
  input: {
    readonly claim: AiExecutionClaim;
    readonly repository: PostgresAiJobRepository;
    readonly sequence: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly evidenceRefs: readonly string[];
    readonly failureCode: string;
    readonly reason: string;
    readonly maximumAttempts: number;
    readonly now: Date;
  },
): Promise<AiJobWorkerResult> {
  await append(input.repository, {
    eventId: randomUUID(),
    jobId: input.claim.jobId,
    tenantId: input.claim.tenantId,
    sequence: input.sequence,
    type: 'FAILED',
    occurredAt: input.now.toISOString(),
    actorSubjectId: input.actorSubjectId,
    reason: input.reason,
    correlationId: input.correlationId,
    evidenceRefs: input.evidenceRefs,
    failureCode: input.failureCode,
  });

  if (input.claim.attempts < input.maximumAttempts) {
    const retryAt = new Date(
      input.now.getTime()
        + Math.min(15 * 60_000, 30_000 * input.claim.attempts),
    );
    await append(input.repository, {
      eventId: randomUUID(),
      jobId: input.claim.jobId,
      tenantId: input.claim.tenantId,
      sequence: input.sequence + 1,
      type: 'RETRY_SCHEDULED',
      occurredAt: input.now.toISOString(),
      actorSubjectId: input.actorSubjectId,
      reason: 'Retry AI execution after a bounded worker failure.',
      correlationId: input.correlationId,
      evidenceRefs: input.evidenceRefs,
      nextAttemptAt: retryAt.toISOString(),
    });
    const queue = await failAiJobExecution(client, {
      claim: input.claim,
      error: input.reason,
      failedAt: input.now,
      retryAt,
      maxAttempts: input.maximumAttempts,
    });
    return {
      status: queue === 'FAILED' ? 'RETRY_SCHEDULED' : queue,
      jobId: input.claim.jobId,
      reasonCode: input.failureCode,
    };
  }

  const queue = await failAiJobExecution(client, {
    claim: input.claim,
    error: input.reason,
    failedAt: input.now,
    maxAttempts: input.maximumAttempts,
  });
  return {
    status: queue === 'FAILED' ? 'DEAD' : queue,
    jobId: input.claim.jobId,
    reasonCode: input.failureCode,
  };
}

export async function runAiJobWorkerOnce(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly options: AiJobWorkerOptions;
  },
): Promise<AiJobWorkerResult> {
  const serviceSubjectId = stableServiceSubject(
    input.options.serviceSubjectId,
  );
  const now = input.options.now?.() ?? new Date();

  const claim = await claimAiJobExecution(client, {
    tenantId: input.tenantId,
    now,
    ...(input.options.leaseMs === undefined
      ? {}
      : { leaseMs: input.options.leaseMs }),
    maxAttempts: 10,
  });
  if (claim === null) return { status: 'IDLE' };

  const repository = new PostgresAiJobRepository(client);
  const job = await repository.findById({
    tenantId: claim.tenantId,
    jobId: claim.jobId,
  });
  if (job === null) {
    const queue = await failAiJobExecution(client, {
      claim,
      error: 'Claimed AI execution references a missing job.',
      failedAt: now,
      maxAttempts: 1,
    });
    return {
      status: queue === 'FAILED' ? 'DEAD' : queue,
      jobId: claim.jobId,
      reasonCode: 'AI_JOB_NOT_FOUND',
    };
  }

  const priorEvents = await repository.listEvents({
    tenantId: claim.tenantId,
    jobId: claim.jobId,
  });
  const snapshot = replayAiJob(job, priorEvents);
  if (snapshot.status === 'SUCCEEDED' || snapshot.status === 'CANCELLED') {
    if (
      snapshot.status === 'SUCCEEDED'
      && snapshot.outputReference?.startsWith('supabase-storage://')
    ) {
      await reconcileUsageFromOutputArtifact(client, {
        tenantId: claim.tenantId,
        jobId: claim.jobId,
        correlationId: job.correlationId,
        outputReference: snapshot.outputReference,
        occurredAt: snapshot.updatedAt,
      });
    }
    const completed = await completeAiJobExecution(client, {
      claim,
      completedAt: now,
    });
    return completed
      ? { status: 'ALREADY_TERMINAL', jobId: claim.jobId }
      : {
          status: 'STALE_CLAIM',
          jobId: claim.jobId,
          reasonCode: 'AI_EXECUTION_CLAIM_LOST',
        };
  }

  const sequence = nextSequence(priorEvents);
  await append(repository, {
    eventId: randomUUID(),
    jobId: claim.jobId,
    tenantId: claim.tenantId,
    sequence,
    type: 'STARTED',
    occurredAt: now.toISOString(),
    actorSubjectId: serviceSubjectId,
    reason: 'Claimed durable AI job for provider execution.',
    correlationId: job.correlationId,
    evidenceRefs: [
      `ai-queue:${claim.queueId}`,
      `ai-job:${claim.jobId}`,
    ],
  });

  const evidenceRefs = [
    `ai-queue:${claim.queueId}`,
    `ai-job:${claim.jobId}`,
    job.intent.inputReference,
    ...(job.intent.contextReference === undefined
      ? []
      : [job.intent.contextReference]),
  ];

  if (!DURABLE_TEXT_OPERATIONS.has(job.intent.operation)) {
    return retryOrDead(client, {
      claim,
      repository,
      sequence: sequence + 1,
      actorSubjectId: serviceSubjectId,
      correlationId: job.correlationId,
      evidenceRefs,
      failureCode: 'AI_OPERATION_NOT_DURABLE_IN_WORKER',
      reason:
        `AI operation ${job.intent.operation} is not enabled in the durable text worker.`,
      maximumAttempts: 1,
      now,
    });
  }

  if (input.options.artifactStorage === undefined) {
    return retryOrDead(client, {
      claim,
      repository,
      sequence: sequence + 1,
      actorSubjectId: serviceSubjectId,
      correlationId: job.correlationId,
      evidenceRefs,
      failureCode: 'AI_ARTIFACT_STORAGE_NOT_CONFIGURED',
      reason: 'Durable AI output storage is not configured.',
      maximumAttempts: 1,
      now,
    });
  }

  try {
    const inputArtifact = await loadAiJobArtifact(client, {
      tenantId: claim.tenantId,
      jobId: claim.jobId,
      reference: job.intent.inputReference,
      expectedType: 'INPUT',
    });
    const contextArtifact =
      job.intent.contextReference === undefined
        ? null
        : await loadAiJobArtifact(client, {
            tenantId: claim.tenantId,
            jobId: claim.jobId,
            reference: job.intent.contextReference,
            expectedType: 'CONTEXT',
          });

    const capabilityKey = aiCapabilityKey(job.intent.operation);
    const registry = new PostgresProviderRegistryRepository(client);
    const [connectors, routingPolicy] = await Promise.all([
      registry.listConnectors(claim.tenantId, capabilityKey),
      registry.loadRoutingPolicy(claim.tenantId, capabilityKey),
    ]);

    const artifactStore = await createGovernedSupabaseArtifactStore(
      client,
      {
        tenantId: claim.tenantId,
        organizationId: NO_ORGANIZATION_AUTH_CONTEXT,
        serviceSubjectId,
        correlationId: job.correlationId,
        projectUrl: input.options.artifactStorage.projectUrl,
        bucket: input.options.artifactStorage.bucket,
        requiredResidencyTags:
          input.options.artifactStorage.requiredResidencyTags ?? [],
        requiredComplianceTags:
          input.options.artifactStorage.requiredComplianceTags ?? [],
        ...(input.options.artifactStorage.signedUrlTtlSeconds === undefined
          ? {}
          : {
              signedUrlTtlSeconds:
                input.options.artifactStorage.signedUrlTtlSeconds,
            }),
        ...(input.options.secretResolver === undefined
          ? {}
          : { secretResolver: input.options.secretResolver }),
        ...(input.options.fetchImpl === undefined
          ? {}
          : { fetchImpl: input.options.fetchImpl }),
        ...(input.options.now === undefined
          ? {}
          : { now: input.options.now }),
      },
    );
    const artifactSink = new PostgresIndexedDurableArtifactSink(
      client,
      artifactStore,
    );

    const credentialNow = () =>
      (input.options.now?.() ?? new Date()).toISOString();
    const leaseService = createGovernedCredentialLeaseRuntime({
      client,
      contextProvider: {
        async resolve() {
          return {
            subjectId: serviceSubjectId,
            actorKind: 'service',
            tenantId: claim.tenantId,
            organizationId: NO_ORGANIZATION_AUTH_CONTEXT,
          };
        },
      },
      now: credentialNow,
    });
    const tokenProvider = governedAiApiTokenProvider({
      connectors,
      credentialRepository:
        new PostgresConnectorCredentialRepository(client),
      leaseService,
      secretResolver:
        input.options.secretResolver ?? delegatedSecretResolver,
      requestedBySubjectId: serviceSubjectId,
      requestId: () => randomUUID(),
      correlationId: () => job.correlationId,
      now: credentialNow,
    });

    const adapters = new Map<string, AiProviderAdapter>();
    for (const connector of connectors) {
      const kind = adapterKind(connector);
      if (kind === 'openai') {
        adapters.set(
          connector.connectorKey,
          new OpenAiAiAdapter({
            apiToken: tokenProvider,
            ...(input.options.fetchImpl === undefined
              ? {}
              : { fetchImpl: input.options.fetchImpl }),
            now: credentialNow,
          }),
        );
      } else if (kind === 'gemini') {
        adapters.set(
          connector.connectorKey,
          new GeminiAiAdapter({
            apiToken: tokenProvider,
            ...(input.options.fetchImpl === undefined
              ? {}
              : { fetchImpl: input.options.fetchImpl }),
            now: credentialNow,
          }),
        );
      }
    }

    const gateway = new RoutedAiGateway({
      connectors,
      adapters,
      ...(routingPolicy === null ? {} : { policies: [routingPolicy] }),
    });

    const proposal = await gateway.invoke({
      ...job.intent,
      inputReference: inputArtifact.content,
      ...(contextArtifact === null
        ? {}
        : { contextReference: contextArtifact.content }),
      requestedAt: now.toISOString(),
    });

    if (
      job.intent.operation !== 'EMBED'
      && proposal.outputContent === undefined
    ) {
      throw new Error('AI_PROVIDER_OUTPUT_CONTENT_MISSING');
    }

    if (proposal.outputContent === undefined) {
      throw new Error('AI_PROVIDER_OUTPUT_CONTENT_MISSING');
    }

    const providerCostOwnership =
      connectors.find(
        (entry) =>
          entry.connectorKey === proposal.provenance.connectorKey,
      )?.ownership === 'TENANT'
        ? 'BYOK'
        : 'EXPADIO_MANAGED';

    const storedOutput = await artifactSink.write({
      tenantId: claim.tenantId,
      artifactKind: 'AI_TEXT',
      sourceKind: 'AI_INVOCATION',
      sourceId: `ai-job:${claim.jobId}`,
      content: proposal.outputContent.value,
      contentType: proposal.outputContent.mediaType,
      providerKey: proposal.provenance.providerKey,
      connectorKey: proposal.provenance.connectorKey,
      modelKey: proposal.provenance.modelKey,
      capabilityKey,
      costMinorUnits: proposal.provenance.costMinorUnits ?? 0,
      providerCostOwnership,
      correlationId: job.correlationId,
      requiredResidencyTags:
        job.intent.governance.requiredResidencyTags,
      requiredComplianceTags:
        job.intent.governance.requiredComplianceTags,
    });

    const outputReference = storedOutput.contentReference;

    const completedAt = input.options.now?.() ?? new Date();
    await append(repository, {
      eventId: randomUUID(),
      jobId: claim.jobId,
      tenantId: claim.tenantId,
      sequence: sequence + 1,
      type: 'SUCCEEDED',
      occurredAt: completedAt.toISOString(),
      actorSubjectId: serviceSubjectId,
      reason: 'AI provider execution completed with durable provenance.',
      correlationId: job.correlationId,
      evidenceRefs,
      outputReference,
      ...(proposal.confidence === undefined
        ? {}
        : { confidence: proposal.confidence }),
      costMinorUnits: proposal.provenance.costMinorUnits ?? 0,
    });

    await reconcileUsageFromOutputArtifact(client, {
      tenantId: claim.tenantId,
      jobId: claim.jobId,
      correlationId: job.correlationId,
      outputReference,
      occurredAt: completedAt.toISOString(),
    });

    const completed = await completeAiJobExecution(client, {
      claim,
      completedAt,
    });
    if (!completed) {
      return {
        status: 'STALE_CLAIM',
        jobId: claim.jobId,
        reasonCode: 'AI_EXECUTION_CLAIM_LOST',
      };
    }

    return {
      status: 'SUCCEEDED',
      jobId: claim.jobId,
      outputReference,
      connectorKey: proposal.provenance.connectorKey,
      providerKey: proposal.provenance.providerKey,
      modelKey: proposal.provenance.modelKey,
      costMinorUnits: proposal.provenance.costMinorUnits ?? 0,
    };
  } catch (error) {
    const failedAt = input.options.now?.() ?? new Date();
    return retryOrDead(client, {
      claim,
      repository,
      sequence: sequence + 1,
      actorSubjectId: serviceSubjectId,
      correlationId: job.correlationId,
      evidenceRefs,
      failureCode:
        error instanceof Error && error.message.includes(':')
          ? error.message.split(':', 1)[0]!
          : 'AI_EXECUTION_FAILED',
      reason:
        error instanceof Error
          ? error.message
          : 'Unknown AI provider execution failure.',
      maximumAttempts: job.maximumAttempts,
      now: failedAt,
    });
  }
}
