import { createHash } from 'node:crypto';
import type {
  DurableArtifactSink,
  DurableArtifactWriteInput,
  DurableArtifactWriteResult,
} from '@expadio/storage';
import {
  persistExecutionArtifact,
  type ExecutionArtifactSqlClient,
} from './execution-artifact.ts';

/**
 * Adds the immutable PostgreSQL artifact index around a durable blob sink.
 * Blob storage owns bytes; PostgreSQL owns replay identity, tenant scope,
 * provider/model provenance, and billing attribution.
 */
export class PostgresIndexedDurableArtifactSink
implements DurableArtifactSink {
  readonly #client: ExecutionArtifactSqlClient;
  readonly #delegate: DurableArtifactSink;

  constructor(
    client: ExecutionArtifactSqlClient,
    delegate: DurableArtifactSink,
  ) {
    this.#client = client;
    this.#delegate = delegate;
  }

  async write(
    input: DurableArtifactWriteInput,
  ): Promise<DurableArtifactWriteResult> {
    const stored = await this.#delegate.write(input);

    const bytes = typeof input.content === 'string'
      ? new TextEncoder().encode(input.content)
      : input.content;
    const expectedSha256 = createHash('sha256')
      .update(bytes)
      .digest('hex');

    if (stored.sha256.toLowerCase() !== expectedSha256) {
      throw new Error('EXECUTION_ARTIFACT_STORAGE_DIGEST_MISMATCH');
    }
    if (stored.byteLength !== bytes.byteLength) {
      throw new Error('EXECUTION_ARTIFACT_STORAGE_BYTE_LENGTH_MISMATCH');
    }

    await persistExecutionArtifact(this.#client, {
      tenantId: input.tenantId,
      artifactKind: input.artifactKind,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      storageReference: stored.contentReference,
      contentSha256: stored.sha256,
      mediaType: input.contentType,
      byteLength: stored.byteLength,
      providerKey: input.providerKey,
      connectorKey: input.connectorKey,
      modelKey: input.modelKey ?? null,
      capabilityKey: input.capabilityKey,
      costMinorUnits: input.costMinorUnits,
      providerCostOwnership: input.providerCostOwnership,
      correlationId: input.correlationId ?? null,
    });

    return stored;
  }
}
