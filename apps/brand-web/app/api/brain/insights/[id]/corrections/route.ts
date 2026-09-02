import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const correction = typeof body.correction === 'string' ? body.correction.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!id || !correction || !idempotencyKey) {
      return NextResponse.json({ code: 'INVALID_CORRECTION', message: 'Insight id, correction and idempotencyKey are required.' }, { status: 400 });
    }
    const result = await withBrandTransaction(context, async (client) => {
      const insight = await client.query(
        `SELECT insight_id, insight_key, statement, confidence, model_name, model_version
           FROM platform.brand_brain_insights
          WHERE insight_id=$1::uuid AND tenant_id=$2::uuid AND organization_id=$3::uuid
            AND status IN ('REVIEWED','PUBLISHED')`,
        [id, context.tenantId, context.organizationId],
      );
      if (insight.rows.length === 0) return null;
      const inserted = await client.query(
        `INSERT INTO platform.brand_brain_observations
          (tenant_id, organization_id, source_type, source_ref, occurred_at, payload, idempotency_key, created_by_subject_id)
         VALUES ($1::uuid, $2::uuid, 'CORRECTION', $3, now(), $4::jsonb, $5, $6)
         ON CONFLICT (tenant_id, idempotency_key)
         DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING observation_id, source_type, source_ref, payload, created_at`,
        [context.tenantId, context.organizationId, `insight:${id}`, JSON.stringify({ insightId:id, correction, prior:insight.rows[0] }), idempotencyKey, context.subjectId],
      );
      return inserted.rows[0];
    });
    if (!result) return NextResponse.json({ code: 'INSIGHT_NOT_FOUND', message: 'Reviewed insight not found in this Brand workspace.' }, { status: 404 });
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ code: 'BRAND_BRAIN_UNAVAILABLE', message: 'Brand Brain correction intake is unavailable.' }, { status: 503 });
  }
}
