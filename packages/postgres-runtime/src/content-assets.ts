import {
  assertContentAssetTransition,
  validateContentAssetRegistration,
  type ContentAssetRegistrationInput,
  type ContentAssetState,
} from '@expadio/storage';
import type { PostgresClient } from './index.ts';

export interface ContentAssetRecord {
  readonly assetId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly purpose: string;
  readonly filename: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly storageObjectReference: string;
  readonly state: ContentAssetState;
  readonly idempotent: boolean;
}

interface AssetRow {
  readonly asset_id: string;
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly purpose: string;
  readonly filename: string;
  readonly content_type: string;
  readonly byte_length: string | number;
  readonly sha256: string;
  readonly storage_object_reference: string;
  readonly state: ContentAssetState;
}

const SELECT = `asset_id, tenant_id, organization_id, purpose, filename, content_type,
  byte_length, sha256, storage_object_reference, state`;

function record(row: AssetRow, idempotent: boolean): ContentAssetRecord {
  return {
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    purpose: row.purpose,
    filename: row.filename,
    contentType: row.content_type,
    byteLength: Number(row.byte_length),
    sha256: row.sha256,
    storageObjectReference: row.storage_object_reference,
    state: row.state,
    idempotent,
  };
}

export async function registerContentAsset(
  client: PostgresClient,
  input: ContentAssetRegistrationInput,
): Promise<ContentAssetRecord> {
  const asset = validateContentAssetRegistration(input);
  const inserted = await client.query<AssetRow>(
    `WITH identity AS (SELECT gen_random_uuid() AS asset_id)
     INSERT INTO platform.content_assets (
       asset_id, tenant_id, organization_id, purpose, filename, content_type,
       byte_length, sha256, storage_object_reference, retention_policy_key,
       retention_policy_version, required_residency_tags, required_compliance_tags,
       idempotency_key, created_by_subject_id, correlation_id
     )
     SELECT identity.asset_id, $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
            'content-assets/' || $1::uuid::text || '/' || $2::uuid::text || '/' || identity.asset_id::text,
            $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14
       FROM identity
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING ${SELECT}`,
    [
      asset.tenantId,
      asset.organizationId,
      asset.purpose,
      asset.filename,
      asset.contentType,
      asset.byteLength,
      asset.sha256,
      asset.retentionPolicy.key,
      asset.retentionPolicy.version,
      JSON.stringify(asset.requiredResidencyTags),
      JSON.stringify(asset.requiredComplianceTags),
      asset.idempotencyKey,
      asset.requestedBySubjectId,
      asset.correlationId,
    ],
  );
  if (inserted.rows[0]) return record(inserted.rows[0], false);

  const existing = await client.query<AssetRow>(
    `SELECT ${SELECT} FROM platform.content_assets
      WHERE tenant_id = $1::uuid AND idempotency_key = $2`,
    [asset.tenantId, asset.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('CONTENT_ASSET_IDEMPOTENCY_LOOKUP_FAILED');
  if (
    row.organization_id !== asset.organizationId
    || row.purpose !== asset.purpose
    || row.filename !== asset.filename
    || row.content_type !== asset.contentType
    || Number(row.byte_length) !== asset.byteLength
    || row.sha256 !== asset.sha256
  ) {
    throw new Error('CONTENT_ASSET_IDEMPOTENCY_CONFLICT');
  }
  return record(row, true);
}

export async function transitionContentAsset(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly toState: ContentAssetState;
    readonly reasonKey: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<ContentAssetRecord> {
  const current = await client.query<AssetRow>(
    `SELECT ${SELECT} FROM platform.content_assets
      WHERE tenant_id = $1::uuid AND asset_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.assetId],
  );
  const row = current.rows[0];
  if (!row) throw new Error('CONTENT_ASSET_NOT_FOUND');
  assertContentAssetTransition(row.state, input.toState);
  if (row.state === input.toState) return record(row, true);

  const updated = await client.query<AssetRow>(
    `UPDATE platform.content_assets
        SET state = $3,
            rejection_reason_key = CASE WHEN $3 = 'REJECTED' THEN $4 ELSE NULL END,
            available_at = CASE WHEN $3 = 'AVAILABLE' THEN now() ELSE available_at END,
            deleted_at = CASE WHEN $3 = 'DELETED' THEN now() ELSE deleted_at END
      WHERE tenant_id = $1::uuid AND asset_id = $2::uuid
      RETURNING ${SELECT}`,
    [input.tenantId, input.assetId, input.toState, input.reasonKey],
  );
  const next = updated.rows[0];
  if (!next) throw new Error('CONTENT_ASSET_TRANSITION_CONFLICT');

  await client.query(
    `INSERT INTO platform.content_asset_events (
       tenant_id, organization_id, asset_id, from_state, to_state,
       reason_key, actor_subject_id, correlation_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)`,
    [
      next.tenant_id,
      next.organization_id,
      next.asset_id,
      row.state,
      next.state,
      input.reasonKey,
      input.actorSubjectId,
      input.correlationId,
    ],
  );
  return record(next, false);
}
