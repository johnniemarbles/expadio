import { randomUUID } from 'node:crypto';
import { issueContentAssetReadGrant } from '@expadio/postgres-runtime/content-assets';
import { contentAssetError, contentAssetForbidden, contentAssetJson } from '@/lib/content-asset-api';
import { createContentAssetBinaryStore } from '@/lib/content-asset-services';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { requireLearningUuid } from '@/lib/learning-errors';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const assetId = requireLearningUuid(decodeURIComponent((await params).id), 'assetId');
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return null;
      return issueContentAssetReadGrant(client, createContentAssetBinaryStore(), {
        tenantId: context.tenantId,
        assetId,
        purpose: 'learning.authoring-preview',
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
