import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Attribution touches + consent evidence for one capture lead (org-scoped). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const captureLeadId = (await params).id.trim();
    if (!UUID.test(captureLeadId)) {
      return NextResponse.json({ error: 'A valid capture lead id is required.' }, { status: 400 });
    }
    return await withBrandTransaction(context, async (client) => {
      const scope = [context.tenantId, context.organizationId, captureLeadId];
      const attribution = await client.query(
        `SELECT source_key, page_url, referrer_url, utm_source, utm_medium, utm_campaign,
                utm_term, utm_content, utm_id, gclid, fbclid, referral_code, affiliate_key, occurred_at
           FROM platform.lead_attribution_events
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid
          ORDER BY occurred_at ASC`,
        scope,
      );
      const consent = await client.query(
        `SELECT channel, purpose, granted, text_version, occurred_at
           FROM platform.lead_consent_records
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid
          ORDER BY occurred_at ASC`,
        scope,
      );
      const touches = attribution.rows;
      return NextResponse.json({
        captureLeadId,
        firstTouch: touches[0] ?? null,
        latestTouch: touches.length > 0 ? touches[touches.length - 1] : null,
        touches,
        consent: consent.rows,
      });
    });
  } catch (error) {
    console.error('Capture attribution read failed:', error);
    return NextResponse.json({ error: 'Unable to load attribution.' }, { status: 500 });
  }
}
