import { randomUUID } from 'node:crypto';
import { issueMyLearningLessonAssetReadGrant } from '@expadio/postgres-runtime/content-assets';
import { contentAssetError, contentAssetJson } from '@/lib/content-asset-api';
import { createContentAssetBinaryStore } from '@/lib/content-asset-services';
import { requireLearningUuid } from '@/lib/learning-errors';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enrollmentId: string; lessonId: string; assetId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const value = await params;
    const enrollmentId = requireLearningUuid(decodeURIComponent(value.enrollmentId), 'enrollmentId');
    const lessonId = requireLearningUuid(decodeURIComponent(value.lessonId), 'lessonId');
    const assetId = requireLearningUuid(decodeURIComponent(value.assetId), 'assetId');
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

    const grant = await withTenantTransaction(context, (client) =>
      issueMyLearningLessonAssetReadGrant(client, createContentAssetBinaryStore(), {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer ?? null,
        enrollmentId,
        lessonId,
        assetId,
        correlationId,
      }),
    );
    return contentAssetJson({ url: grant.url, expiresAt: grant.expiresAt });
  } catch (error) {
    if (error instanceof Error && error.message === 'LEARNING_ASSET_ACCESS_DENIED') {
      return contentAssetJson({
        denied: true,
        reasonKey: error.message,
        message: 'This protected lesson asset is not available to the current learner.',
      }, 404);
    }
    return contentAssetError(error);
  }
}
