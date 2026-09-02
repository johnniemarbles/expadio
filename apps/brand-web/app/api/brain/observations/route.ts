import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

const SOURCE_TYPES = new Set(['CALL','CONVERSATION','DECISION','TASK','MOVEMENT','OUTCOME','DOCUMENT','CORRECTION']);

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json() as Record<string, unknown>;
    const sourceType = typeof body.sourceType === 'string' ? body.sourceType.toUpperCase() : '';
    const sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const occurredAt = typeof body.occurredAt === 'string' ? body.occurredAt : new Date().toISOString();
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    if (!SOURCE_TYPES.has(sourceType) || !sourceRef || !idempotencyKey) {
      return NextResponse.json({ code: 'INVALID_OBSERVATION', message: 'sourceType, sourceRef and idempotencyKey are required.' }, { status: 400 });
    }
    const result = await withBrandTransaction(context, async (client) => {
      const inserted = await client.query(
        `INSERT INTO platform.brand_brain_observations
          (tenant_id, organization_id, source_type, source_ref, occurred_at, payload, idempotency_key, created_by_subject_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::jsonb, $7, $8)
         ON CONFLICT (tenant_id, idempotency_key)
         DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING observation_id, tenant_id, organization_id, source_type, source_ref, occurred_at, payload, idempotency_key, created_by_subject_id, created_at`,
        [context.tenantId, context.organizationId, sourceType, sourceRef, occurredAt, JSON.stringify(payload), idempotencyKey, context.subjectId],
      );
      return inserted.rows[0];
    });
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ code: 'BRAND_BRAIN_UNAVAILABLE', message: 'Brand Brain observation intake is unavailable.' }, { status: 503 });
  }
}
