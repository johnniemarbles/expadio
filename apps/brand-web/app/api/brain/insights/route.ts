import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const rows = await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT insight_id, tenant_id, organization_id, insight_key, statement, confidence,
                status, model_name, model_version, evidence_ids, correction_of_insight_id,
                created_by_subject_id, reviewed_by_subject_id, created_at, reviewed_at
           FROM platform.brand_brain_insights
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND status IN ('REVIEWED','PUBLISHED')
          ORDER BY created_at DESC
          LIMIT 100`,
        [context.tenantId, context.organizationId],
      );
      return result.rows;
    });
    return NextResponse.json({ insights: rows });
  } catch {
    return NextResponse.json({ code: 'BRAND_BRAIN_UNAVAILABLE', message: 'Brand Brain insights are unavailable.' }, { status: 503 });
  }
}
