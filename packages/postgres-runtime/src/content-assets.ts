import {
  assertContentAssetTransition,
  validateContentAssetRegistration,
  type ContentAssetRegistrationInput,
  type ContentAssetState,
  type ContentAssetBinaryStore,
  type ContentAssetReadGrant,
  type ContentAssetScanner,
  type ContentAssetScanResult,
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

interface TransferAssetRow extends AssetRow {
  readonly retention_policy_key: string;
  readonly retention_policy_version: number;
  readonly required_residency_tags: readonly string[];
  readonly required_compliance_tags: readonly string[];
  readonly correlation_id: string;
}

const TRANSFER_SELECT = `${SELECT}, retention_policy_key, retention_policy_version,
  required_residency_tags, required_compliance_tags, correlation_id`;

export async function uploadContentAsset(
  client: PostgresClient,
  store: ContentAssetBinaryStore,
  input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly content: Uint8Array;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<ContentAssetRecord> {
  const loaded = await client.query<TransferAssetRow>(
    `SELECT ${TRANSFER_SELECT} FROM platform.content_assets
      WHERE tenant_id = $1::uuid AND asset_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.assetId],
  );
  const asset = loaded.rows[0];
  if (!asset) throw new Error('CONTENT_ASSET_NOT_FOUND');
  if (asset.state !== 'PENDING_UPLOAD') throw new Error('CONTENT_ASSET_NOT_PENDING_UPLOAD');

  const stored = await store.store({
    tenantId: asset.tenant_id,
    organizationId: asset.organization_id,
    assetId: asset.asset_id,
    objectReference: asset.storage_object_reference,
    content: input.content,
    contentType: asset.content_type,
    expectedByteLength: Number(asset.byte_length),
    expectedSha256: asset.sha256,
    requiredResidencyTags: [...asset.required_residency_tags],
    requiredComplianceTags: [...asset.required_compliance_tags],
    correlationId: input.correlationId,
  });
  if (
    stored.objectReference !== asset.storage_object_reference
    || stored.byteLength !== Number(asset.byte_length)
    || stored.sha256 !== asset.sha256
  ) {
    throw new Error('CONTENT_ASSET_PROVIDER_VERIFICATION_MISMATCH');
  }

  return transitionContentAsset(client, {
    tenantId: input.tenantId,
    assetId: input.assetId,
    toState: 'UPLOADED',
    reasonKey: 'PROVIDER_WRITE_VERIFIED',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
  });
}

export async function issueContentAssetReadGrant(
  client: PostgresClient,
  store: ContentAssetBinaryStore,
  input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly purpose: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<ContentAssetReadGrant> {
  const loaded = await client.query<TransferAssetRow>(
    `SELECT ${TRANSFER_SELECT} FROM platform.content_assets
      WHERE tenant_id = $1::uuid AND asset_id = $2::uuid
        AND state = 'AVAILABLE'`,
    [input.tenantId, input.assetId],
  );
  const asset = loaded.rows[0];
  if (!asset) throw new Error('CONTENT_ASSET_NOT_AVAILABLE');

  const grant = await store.issueReadGrant({
    tenantId: asset.tenant_id,
    organizationId: asset.organization_id,
    assetId: asset.asset_id,
    objectReference: asset.storage_object_reference,
    purpose: input.purpose,
    requiredResidencyTags: [...asset.required_residency_tags],
    requiredComplianceTags: [...asset.required_compliance_tags],
  });

  await client.query(
    `INSERT INTO platform.content_asset_events (
       tenant_id, organization_id, asset_id, from_state, to_state,
       reason_key, actor_subject_id, correlation_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'AVAILABLE', 'AVAILABLE',
               'READ_GRANT_ISSUED', $4, $5)`,
    [
      asset.tenant_id,
      asset.organization_id,
      asset.asset_id,
      input.actorSubjectId,
      input.correlationId,
    ],
  );
  return grant;
}


/**
 * Issues a short-lived read grant only when the authenticated learner owns an
 * active enrollment for the immutable course version, the lesson is unlocked,
 * and the asset is referenced by that exact lesson document.
 */
export async function issueMyLearningLessonAssetReadGrant(
  client: PostgresClient,
  store: ContentAssetBinaryStore,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly subjectIssuer: string | null;
    readonly enrollmentId: string;
    readonly lessonId: string;
    readonly assetId: string;
    readonly correlationId: string;
  },
): Promise<ContentAssetReadGrant> {
  const authorized = await client.query<{ readonly allowed: boolean }>(
    `SELECT true AS allowed
       FROM platform.learning_enrollments enrollment
       JOIN platform.learning_learners learner
         ON learner.learner_id = enrollment.learner_id
        AND learner.tenant_id = enrollment.tenant_id
        AND learner.subject_id = $3
        AND learner.subject_issuer IS NOT DISTINCT FROM $4
        AND learner.status = 'ACTIVE'
       JOIN platform.learning_lessons lesson
         ON lesson.lesson_id = $5::uuid
        AND lesson.course_version_id = enrollment.course_version_id
        AND lesson.tenant_id = enrollment.tenant_id
       JOIN platform.content_assets asset
         ON asset.asset_id = $6::uuid
        AND asset.tenant_id = enrollment.tenant_id
        AND asset.purpose = 'LEARNING_CONTENT'
        AND asset.state = 'AVAILABLE'
      WHERE enrollment.tenant_id = $1::uuid
        AND enrollment.enrollment_id = $2::uuid
        AND enrollment.status IN ('ASSIGNED','IN_PROGRESS')
        AND EXISTS (
          SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(lesson.content->'blocks') = 'array'
                THEN lesson.content->'blocks' ELSE '[]'::jsonb END
            ) AS block
           WHERE block->'data'->>'assetId' = $6
              OR block->'accessibility'->>'transcriptAssetId' = $6
              OR block->'accessibility'->>'captionsAssetId' = $6
        )
        AND NOT EXISTS (
          SELECT 1
            FROM platform.learning_lessons prior
            JOIN platform.learning_course_modules prior_module
              ON prior_module.course_module_id = prior.course_module_id
             AND prior_module.tenant_id = prior.tenant_id
            JOIN platform.learning_course_modules target_module
              ON target_module.course_module_id = lesson.course_module_id
             AND target_module.tenant_id = lesson.tenant_id
           WHERE prior.tenant_id = enrollment.tenant_id
             AND prior.course_version_id = enrollment.course_version_id
             AND prior.required = true
             AND (prior_module.position, prior.position) < (target_module.position, lesson.position)
             AND NOT EXISTS (
               SELECT 1
                 FROM platform.learning_lesson_progress progress
                WHERE progress.tenant_id = enrollment.tenant_id
                  AND progress.enrollment_id = enrollment.enrollment_id
                  AND progress.lesson_id = prior.lesson_id
                  AND progress.status = 'COMPLETED'
             )
        )
      LIMIT 1`,
    [
      input.tenantId,
      input.enrollmentId,
      input.subjectId,
      input.subjectIssuer,
      input.lessonId,
      input.assetId,
    ],
  );
  if (!authorized.rows[0]) throw new Error('LEARNING_ASSET_ACCESS_DENIED');

  return issueContentAssetReadGrant(client, store, {
    tenantId: input.tenantId,
    assetId: input.assetId,
    purpose: 'learning.learner-playback',
    actorSubjectId: input.subjectId,
    correlationId: input.correlationId,
  });
}


export async function quarantineContentAssetForScan(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<ContentAssetRecord> {
  return transitionContentAsset(client, {
    ...input,
    toState: 'QUARANTINED',
    reasonKey: 'MALWARE_SCAN_REQUIRED',
  });
}

async function appendContentAssetEvidence(
  client: PostgresClient,
  asset: TransferAssetRow,
  input: {
    readonly reasonKey: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.content_asset_events (
       tenant_id, organization_id, asset_id, from_state, to_state,
       reason_key, actor_subject_id, correlation_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, $5, $6, $7)`,
    [
      asset.tenant_id,
      asset.organization_id,
      asset.asset_id,
      asset.state,
      input.reasonKey,
      input.actorSubjectId,
      input.correlationId,
    ],
  );
}

export async function resolveQuarantinedContentAssetScan(
  client: PostgresClient,
  scanner: ContentAssetScanner,
  input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{
  readonly asset: ContentAssetRecord;
  readonly scan: ContentAssetScanResult;
}> {
  const loaded = await client.query<TransferAssetRow>(
    `SELECT ${TRANSFER_SELECT} FROM platform.content_assets
      WHERE tenant_id = $1::uuid AND asset_id = $2::uuid
        AND state = 'QUARANTINED'
      FOR UPDATE`,
    [input.tenantId, input.assetId],
  );
  const asset = loaded.rows[0];
  if (!asset) throw new Error('CONTENT_ASSET_NOT_QUARANTINED');

  const scan = await scanner.scan({
    tenantId: asset.tenant_id,
    organizationId: asset.organization_id,
    assetId: asset.asset_id,
    objectReference: asset.storage_object_reference,
    contentType: asset.content_type,
    byteLength: Number(asset.byte_length),
    sha256: asset.sha256,
    correlationId: input.correlationId,
  });
  if (
    scan.assetId !== asset.asset_id
    || scan.objectReference !== asset.storage_object_reference
    || scan.sha256 !== asset.sha256
  ) {
    throw new Error('CONTENT_ASSET_SCAN_VERIFICATION_MISMATCH');
  }

  if (scan.verdict === 'INDETERMINATE') {
    await appendContentAssetEvidence(client, asset, {
      reasonKey: `MALWARE_SCAN_INDETERMINATE:${scan.reasonKey}`,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
    });
    return { asset: record(asset, true), scan };
  }

  const next = await transitionContentAsset(client, {
    tenantId: input.tenantId,
    assetId: input.assetId,
    toState: scan.verdict === 'CLEAN' ? 'AVAILABLE' : 'REJECTED',
    reasonKey: scan.verdict === 'CLEAN'
      ? `MALWARE_SCAN_CLEAN:${scan.engine}:${scan.signatureVersion}`
      : `MALWARE_SCAN_REJECTED:${scan.reasonKey}`,
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
  });
  return { asset: next, scan };
}


export async function loadContentAsset(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly assetId: string },
): Promise<ContentAssetRecord> {
  const result = await client.query<AssetRow>(
    `SELECT ${SELECT} FROM platform.content_assets
      WHERE tenant_id = $1::uuid AND asset_id = $2::uuid`,
    [input.tenantId, input.assetId],
  );
  const asset = result.rows[0];
  if (!asset) throw new Error('CONTENT_ASSET_NOT_FOUND');
  return record(asset, false);
}
