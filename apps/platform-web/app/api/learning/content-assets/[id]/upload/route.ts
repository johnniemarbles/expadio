import { randomUUID } from 'node:crypto';
import { uploadContentAsset } from '@expadio/postgres-runtime/content-assets';
import { contentAssetError, contentAssetForbidden, contentAssetJson } from '@/lib/content-asset-api';
import { createContentAssetBinaryStore } from '@/lib/content-asset-services';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { requireLearningUuid } from '@/lib/learning-errors';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_ROUTE_BYTES = 100 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const assetId = requireLearningUuid(decodeURIComponent((await params).id), 'assetId');
    const authorized = await withTenantTransaction(context, (client) =>
      hasLearningAuthoringRole(client, context.subjectId),
    );
    if (!authorized) return contentAssetForbidden();
    const declared = Number(request.headers.get('content-length'));
    if (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_ROUTE_BYTES) {
      return contentAssetJson({
        reasonKey: 'CONTENT_ASSET_UPLOAD_LENGTH_INVALID',
        message: 'A valid Content-Length up to 100 MiB is required.',
      }, 413);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== declared) {
      return contentAssetJson({
        reasonKey: 'CONTENT_ASSET_UPLOAD_LENGTH_MISMATCH',
        message: 'The uploaded byte length did not match Content-Length.',
      }, 400);
    }
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return null;
      return uploadContentAsset(client, createContentAssetBinaryStore(), {
        tenantId: context.tenantId,
        assetId,
        content: bytes,
        actorSubjectId: context.subjectId,
        correlationId,
      });
    });
    if (result === null) return contentAssetForbidden();
    return contentAssetJson(result);
  } catch (error) {
    return contentAssetError(error);
  }
}
