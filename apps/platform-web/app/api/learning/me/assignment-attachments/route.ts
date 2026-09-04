import { randomUUID } from 'node:crypto';
import {
  quarantineContentAssetForScan,
  registerContentAsset,
  resolveQuarantinedContentAssetScan,
  uploadContentAsset,
} from '@expadio/postgres-runtime/content-assets';
import { authorizeMyLearningAssignmentAttachment } from '@expadio/postgres-runtime/learning-assignment';
import { contentAssetError, contentAssetJson } from '@/lib/content-asset-api';
import {
  configuredContentAssetPolicy,
  createContentAssetBinaryStore,
  createContentAssetScanner,
} from '@/lib/content-asset-services';
import { requireLearningUuid } from '@/lib/learning-errors';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 25 * 1024 * 1024;
const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/i;

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) return contentAssetJson({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, 403);
    const url = new URL(request.url);
    const enrollmentId = requireLearningUuid(url.searchParams.get('enrollmentId') ?? '', 'enrollmentId');
    const lessonId = requireLearningUuid(url.searchParams.get('lessonId') ?? '', 'lessonId');
    const assignmentKey = url.searchParams.get('assignmentKey')?.trim().toLowerCase() ?? '';
    const filename = decodeURIComponent(request.headers.get('x-expadio-filename') ?? '');
    const contentType = request.headers.get('content-type')?.trim().toLowerCase() ?? '';
    const sha256 = request.headers.get('x-content-sha256')?.trim().toLowerCase() ?? '';
    const idempotencyKey = request.headers.get('x-idempotency-key')?.trim() ?? '';
    const declared = Number(request.headers.get('content-length'));
    if (!KEY.test(assignmentKey) || filename === '' || !SHA256.test(sha256) || idempotencyKey === ''
      || !Number.isSafeInteger(declared) || declared < 1 || declared > MAX_BYTES) {
      return contentAssetJson({ reasonKey: 'LEARNING_ASSIGNMENT_ATTACHMENT_INVALID' }, 400);
    }
    await withTenantTransaction(context, (client) => authorizeMyLearningAssignmentAttachment(client, {
      tenantId: context.tenantId, subjectId: context.subjectId, subjectIssuer: context.issuer ?? null,
      enrollmentId, lessonId, assignmentKey,
    }));

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== declared) return contentAssetJson({ reasonKey: 'CONTENT_ASSET_UPLOAD_LENGTH_MISMATCH' }, 400);
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();
    const policy = configuredContentAssetPolicy();
    const asset = await withTenantTransaction(context, async (client) => {
      await authorizeMyLearningAssignmentAttachment(client, {
        tenantId: context.tenantId, subjectId: context.subjectId, subjectIssuer: context.issuer ?? null,
        enrollmentId, lessonId, assignmentKey,
      });
      return registerContentAsset(client, {
        tenantId: context.tenantId, organizationId: context.organizationId!,
        requestedBySubjectId: context.subjectId, purpose: 'LEARNING_SUBMISSION',
        filename, contentType, byteLength: declared, sha256, idempotencyKey,
        retentionPolicy: policy.retentionPolicy,
        requiredResidencyTags: policy.requiredResidencyTags,
        requiredComplianceTags: policy.requiredComplianceTags,
        correlationId,
      });
    });
    if (asset.state === 'AVAILABLE') {
      return contentAssetJson({ assetId: asset.assetId, state: asset.state, filename, contentType }, 200);
    }
    if (asset.state === 'REJECTED' || asset.state === 'DELETED') {
      return contentAssetJson({ assetId: asset.assetId, state: asset.state, reasonKey: 'LEARNING_ASSIGNMENT_ATTACHMENT_UNAVAILABLE' }, 422);
    }

    let state: string = asset.state;
    if (state === 'PENDING_UPLOAD') {
      const uploaded = await withTenantTransaction(context, (client) => uploadContentAsset(client, createContentAssetBinaryStore(), {
        tenantId: context.tenantId, assetId: asset.assetId, content: bytes,
        actorSubjectId: context.subjectId, correlationId,
      }));
      state = uploaded.state;
    }
    if (state === 'UPLOADED') {
      const quarantined = await withTenantTransaction(context, (client) => quarantineContentAssetForScan(client, {
        tenantId: context.tenantId, assetId: asset.assetId,
        actorSubjectId: context.subjectId, correlationId,
      }));
      state = quarantined.state;
    }
    if (state !== 'QUARANTINED') {
      return contentAssetJson({ assetId: asset.assetId, state, reasonKey: 'LEARNING_ASSIGNMENT_ATTACHMENT_STATE_INVALID' }, 409);
    }
    const resolved = await withTenantTransaction(context, (client) =>
      resolveQuarantinedContentAssetScan(client, createContentAssetScanner(), {
        tenantId: context.tenantId, assetId: asset.assetId,
        actorSubjectId: 'service:content-asset-scanner', correlationId,
      }),
    );
    if (resolved.asset.state !== 'AVAILABLE') {
      return contentAssetJson({ assetId: asset.assetId, state: resolved.asset.state, reasonKey: resolved.scan.reasonKey }, 422);
    }
    return contentAssetJson({ assetId: asset.assetId, state: resolved.asset.state, filename, contentType }, asset.idempotent ? 200 : 201);
  } catch (error) {
    return contentAssetError(error);
  }
}
