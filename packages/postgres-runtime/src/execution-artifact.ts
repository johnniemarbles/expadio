export interface ExecutionArtifactSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface ExecutionArtifactSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<ExecutionArtifactSqlResult<Row>>;
}

export type ExecutionArtifactKind =
  | 'AI_TEXT'
  | 'AI_EMBEDDING'
  | 'VOICE_TRANSCRIPT'
  | 'VOICE_AUDIO';

export type ExecutionArtifactSourceKind =
  | 'AI_INVOCATION'
  | 'VOICE_REQUEST';

export interface PersistedExecutionArtifact {
  readonly artifactId: string;
  readonly tenantId: string;
  readonly artifactKind: ExecutionArtifactKind;
  readonly sourceKind: ExecutionArtifactSourceKind;
  readonly sourceId: string;
  readonly storageReference: string;
  readonly contentSha256: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly providerKey: string;
  readonly connectorKey: string;
  readonly modelKey: string | null;
  readonly capabilityKey: string;
  readonly costMinorUnits: number;
  readonly providerCostOwnership: 'BYOK' | 'EXPADIO_MANAGED';
  readonly confidence: number | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
}

interface ExecutionArtifactRow {
  readonly artifact_id: string;
  readonly tenant_id: string;
  readonly artifact_kind: ExecutionArtifactKind;
  readonly source_kind: ExecutionArtifactSourceKind;
  readonly source_id: string;
  readonly storage_reference: string;
  readonly content_sha256: string;
  readonly media_type: string;
  readonly byte_length: string | number;
  readonly provider_key: string;
  readonly connector_key: string;
  readonly model_key: string | null;
  readonly capability_key: string;
  readonly cost_minor_units: string | number;
  readonly provider_cost_ownership: 'BYOK' | 'EXPADIO_MANAGED';
  readonly confidence: string | number | null;
  readonly correlation_id: string | null;
  readonly created_at: Date | string;
}

const COLUMNS = `
  artifact_id, tenant_id, artifact_kind, source_kind, source_id,
  storage_reference, content_sha256, media_type, byte_length,
  provider_key, connector_key, model_key, capability_key,
  cost_minor_units, provider_cost_ownership, confidence,
  correlation_id, created_at
`;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: ExecutionArtifactRow): PersistedExecutionArtifact {
  return {
    artifactId: row.artifact_id,
    tenantId: row.tenant_id,
    artifactKind: row.artifact_kind,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    storageReference: row.storage_reference,
    contentSha256: row.content_sha256,
    mediaType: row.media_type,
    byteLength: Number(row.byte_length),
    providerKey: row.provider_key,
    connectorKey: row.connector_key,
    modelKey: row.model_key,
    capabilityKey: row.capability_key,
    costMinorUnits: Number(row.cost_minor_units),
    providerCostOwnership: row.provider_cost_ownership,
    confidence:
      row.confidence === null ? null : Number(row.confidence),
    correlationId: row.correlation_id,
    createdAt: asDate(row.created_at),
  };
}

function validate(input: {
  readonly tenantId: string;
  readonly artifactKind: ExecutionArtifactKind;
  readonly sourceKind: ExecutionArtifactSourceKind;
  readonly sourceId: string;
  readonly storageReference: string;
  readonly contentSha256: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly providerKey: string;
  readonly connectorKey: string;
  readonly modelKey?: string | null;
  readonly capabilityKey: string;
  readonly costMinorUnits: number;
  readonly providerCostOwnership: 'BYOK' | 'EXPADIO_MANAGED';
  readonly confidence?: number | null;
  readonly correlationId?: string | null;
}): void {
  for (const [name, value] of [
    ['tenantId', input.tenantId],
    ['sourceId', input.sourceId],
    ['storageReference', input.storageReference],
    ['mediaType', input.mediaType],
    ['providerKey', input.providerKey],
    ['connectorKey', input.connectorKey],
  ] as const) {
    if (value.trim() === '') {
      throw new Error(
        `EXECUTION_ARTIFACT_${name.toUpperCase()}_REQUIRED`,
      );
    }
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentSha256)) {
    throw new Error('EXECUTION_ARTIFACT_SHA256_INVALID');
  }
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
    throw new Error('EXECUTION_ARTIFACT_BYTE_LENGTH_INVALID');
  }
  if (
    input.modelKey !== undefined
    && input.modelKey !== null
    && input.modelKey.trim() === ''
  ) {
    throw new Error('EXECUTION_ARTIFACT_MODEL_KEY_INVALID');
  }
  if (input.capabilityKey.trim() === '') {
    throw new Error('EXECUTION_ARTIFACT_CAPABILITY_KEY_REQUIRED');
  }
  if (!Number.isSafeInteger(input.costMinorUnits) || input.costMinorUnits < 0) {
    throw new Error('EXECUTION_ARTIFACT_COST_INVALID');
  }
  if (
    input.confidence !== undefined
    && input.confidence !== null
    && (
      !Number.isFinite(input.confidence)
      || input.confidence < 0
      || input.confidence > 1
    )
  ) {
    throw new Error('EXECUTION_ARTIFACT_CONFIDENCE_INVALID');
  }
  if (
    input.correlationId !== undefined
    && input.correlationId !== null
    && input.correlationId.trim() === ''
  ) {
    throw new Error('EXECUTION_ARTIFACT_CORRELATION_ID_INVALID');
  }
}

export async function persistExecutionArtifact(
  client: ExecutionArtifactSqlClient,
  input: {
    readonly tenantId: string;
    readonly artifactKind: ExecutionArtifactKind;
    readonly sourceKind: ExecutionArtifactSourceKind;
    readonly sourceId: string;
    readonly storageReference: string;
    readonly contentSha256: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly providerKey: string;
    readonly connectorKey: string;
    readonly modelKey?: string | null;
    readonly capabilityKey: string;
    readonly costMinorUnits: number;
    readonly providerCostOwnership: 'BYOK' | 'EXPADIO_MANAGED';
    readonly confidence?: number | null;
    readonly correlationId?: string | null;
  },
): Promise<{
  readonly artifact: PersistedExecutionArtifact;
  readonly replayed: boolean;
}> {
  validate(input);

  const inserted = await client.query<ExecutionArtifactRow>(
    `INSERT INTO platform.execution_artifacts (
       tenant_id, artifact_kind, source_kind, source_id, storage_reference,
       content_sha256, media_type, byte_length, provider_key, connector_key,
       model_key, capability_key, cost_minor_units,
       provider_cost_ownership, confidence, correlation_id
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16
     )
     ON CONFLICT (tenant_id, artifact_kind, source_kind, source_id)
     DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      input.tenantId,
      input.artifactKind,
      input.sourceKind,
      input.sourceId,
      input.storageReference,
      input.contentSha256,
      input.mediaType,
      input.byteLength,
      input.providerKey,
      input.connectorKey,
      input.modelKey ?? null,
      input.capabilityKey,
      input.costMinorUnits,
      input.providerCostOwnership,
      input.confidence ?? null,
      input.correlationId ?? null,
    ],
  );

  const created = inserted.rows[0];
  if (created !== undefined) {
    return { artifact: mapRow(created), replayed: false };
  }

  const existing = await client.query<ExecutionArtifactRow>(
    `SELECT ${COLUMNS}
       FROM platform.execution_artifacts
      WHERE tenant_id = $1::uuid
        AND artifact_kind = $2
        AND source_kind = $3
        AND source_id = $4
      LIMIT 1`,
    [input.tenantId, input.artifactKind, input.sourceKind, input.sourceId],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw new Error('EXECUTION_ARTIFACT_IDEMPOTENCY_CONFLICT');
  }

  if (
    row.storage_reference !== input.storageReference
    || row.content_sha256 !== input.contentSha256
    || row.media_type !== input.mediaType
    || Number(row.byte_length) !== input.byteLength
    || row.provider_key !== input.providerKey
    || row.connector_key !== input.connectorKey
    || row.model_key !== (input.modelKey ?? null)
    || row.capability_key !== input.capabilityKey
    || Number(row.cost_minor_units) !== input.costMinorUnits
    || row.provider_cost_ownership !== input.providerCostOwnership
    || (
      row.confidence === null
        ? (input.confidence ?? null) !== null
        : Number(row.confidence) !== (input.confidence ?? null)
    )
    || row.correlation_id !== (input.correlationId ?? null)
  ) {
    throw new Error('EXECUTION_ARTIFACT_REPLAY_CONFLICT');
  }

  return { artifact: mapRow(row), replayed: true };
}

export async function findExecutionArtifactBySource(
  client: ExecutionArtifactSqlClient,
  input: {
    readonly tenantId: string;
    readonly artifactKind: ExecutionArtifactKind;
    readonly sourceKind: ExecutionArtifactSourceKind;
    readonly sourceId: string;
  },
): Promise<PersistedExecutionArtifact | null> {
  const result = await client.query<ExecutionArtifactRow>(
    `SELECT ${COLUMNS}
       FROM platform.execution_artifacts
      WHERE tenant_id = $1::uuid
        AND artifact_kind = $2
        AND source_kind = $3
        AND source_id = $4
      LIMIT 1`,
    [input.tenantId, input.artifactKind, input.sourceKind, input.sourceId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRow(row);
}
