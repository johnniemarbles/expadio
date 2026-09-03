import { randomUUID } from 'node:crypto';
import { registerContentAsset } from '@expadio/postgres-runtime/content-assets';
import { contentAssetError, contentAssetForbidden, contentAssetJson } from '@/lib/content-asset-api';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return contentAssetJson({
        denied: true,
        reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
        message: 'Select an organization workspace to continue.',
      }, 403);
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasLearningAuthoringRole(client, context.subjectId))) return null;
      return registerContentAsset(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
        requestedBySubjectId: context.subjectId,
        purpose: 'LEARNING_CONTENT',
        filename: body.filename as string,
        contentType: body.contentType as string,
        byteLength: body.byteLength as number,
        sha256: body.sha256 as string,
        idempotencyKey: body.idempotencyKey as string,
        retentionPolicy: body.retentionPolicy as { key: string; version: number },
        requiredResidencyTags: body.requiredResidencyTags as string[],
        requiredComplianceTags: body.requiredComplianceTags as string[] ?? [],
        correlationId,
      });
    });
    if (result === null) return contentAssetForbidden();
    return contentAssetJson(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return contentAssetError(error);
  }
}
