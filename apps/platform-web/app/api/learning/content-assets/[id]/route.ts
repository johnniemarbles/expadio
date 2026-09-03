import { loadContentAsset } from '@expadio/postgres-runtime/content-assets';
import { contentAssetError, contentAssetForbidden, contentAssetJson } from '@/lib/content-asset-api';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { requireLearningUuid } from '@/lib/learning-errors';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const assetId = requireLearningUuid(decodeURIComponent((await params).id), 'assetId');
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return null;
      return loadContentAsset(client, { tenantId: context.tenantId, assetId });
    });
    if (result === null) return contentAssetForbidden();
    return contentAssetJson(result);
  } catch (error) {
    return contentAssetError(error);
  }
}
