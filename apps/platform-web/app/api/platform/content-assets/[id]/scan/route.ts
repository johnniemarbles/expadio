import { randomUUID } from 'node:crypto';
import {
  quarantineContentAssetForScan,
  resolveQuarantinedContentAssetScan,
} from '@expadio/postgres-runtime/content-assets';
import { contentAssetError, contentAssetForbidden, contentAssetJson } from '@/lib/content-asset-api';
import { createContentAssetScanner } from '@/lib/content-asset-services';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { requireLearningUuid } from '@/lib/learning-errors';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Platform orchestration endpoint. The caller may request a scan but cannot
 * submit or override its verdict; only the authenticated scanner response can.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const assetId = requireLearningUuid(decodeURIComponent((await params).id), 'assetId');
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

    const quarantined = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return null;
      return quarantineContentAssetForScan(client, {
        tenantId: context.tenantId,
        assetId,
        actorSubjectId: context.subjectId,
        correlationId,
      });
    });
    if (quarantined === null) return contentAssetForbidden();

    // Deliberately separate transactions: once quarantine commits, provider
    // outage or an invalid verdict cannot roll the asset back to UPLOADED.
    const resolved = await withTenantTransaction(context, async (client) =>
      resolveQuarantinedContentAssetScan(client, createContentAssetScanner(), {
        tenantId: context.tenantId,
        assetId,
        actorSubjectId: 'service:content-asset-scanner',
        correlationId,
      }),
    );
    return contentAssetJson(resolved);
  } catch (error) {
    return contentAssetError(error);
  }
}
