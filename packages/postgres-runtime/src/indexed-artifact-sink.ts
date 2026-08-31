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
 * Adds the immutable PostgreSQL artifact index around a concrete durable blob
 * sink. The delegate owns bytes/object storage; PostgreSQL owns tenant-scoped
 * provenance and replay identity.
 *
 * A delegate write followed by an index failure may leave an orphaned blob,
 * but this wrapper never reports success without durable index evidence.
 */
export class PostgresIndexedDurableArtifactSink implements DurableArtifactSink {
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
      correlationId: input.correlationId ?? null,
    });

    return stored;
  }
}
