import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGES = new Set([
  'NEW_ENQUIRY','CONTACT_ATTEMPTED','CONTACTED','QUALIFICATION','QUALIFIED',
  'DISCOVERY_SCHEDULED','DISCOVERY_COMPLETED','OPPORTUNITY_EVALUATION',
  'APPLICATION_INVITED','APPLICATION_STARTED','APPLICATION_SUBMITTED','DUE_DILIGENCE',
  'APPROVAL','AGREEMENT','ACTIVATION','WON','LOST','DISQUALIFIED','NURTURE',
]);
const STATUSES = new Set([
  'ACTIVE','WAITING_ON_LEAD','WAITING_INTERNAL','ON_HOLD','STALLED',
  'DISQUALIFIED','CONVERTED','LOST','ARCHIVED',
]);

export async function GET(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const url = new URL(request.url);
    const stage = url.searchParams.get('stage')?.trim().toUpperCase() ?? '';
    const status = url.searchParams.get('status')?.trim().toUpperCase() ?? '';
    if (stage && !STAGES.has(stage)) return NextResponse.json({ error: 'Unknown capture stage.' }, { status: 400 });
    if (status && !STATUSES.has(status)) return NextResponse.json({ error: 'Unknown operational status.' }, { status: 400 });

    return await withBrandTransaction(context, async (client) => {
      const rows = await client.query(
        `SELECT l.capture_lead_id, l.organization_id, l.source_id, s.source_key, s.surface,
                l.external_reference, l.title, l.email, l.stage, l.status,
                l.owner_subject_id, l.stage_entered_at, l.close_reason_code,
                l.closed_at, l.created_at, l.updated_at,
                EXISTS (
                  SELECT 1 FROM platform.crm_leads c
                   WHERE c.tenant_id = l.tenant_id
                     AND c.capture_lead_id = l.capture_lead_id
                ) AS projected_to_crm
           FROM platform.lead_capture_leads l
           JOIN platform.lead_capture_sources s
             ON s.tenant_id = l.tenant_id AND s.source_id = l.source_id
          WHERE l.tenant_id = $1::uuid
            AND ($2::text IS NULL OR l.stage = $2)
            AND ($3::text IS NULL OR l.status = $3)
          ORDER BY l.updated_at DESC, l.capture_lead_id DESC
          LIMIT 250`,
        [context.tenantId, stage || null, status || null],
      );
      return NextResponse.json({
        organizationId: context.organizationId,
        stage: stage || null,
        status: status || null,
        leads: rows.rows.map((row) => ({
          captureLeadId: row.capture_lead_id,
          organizationId: row.organization_id,
          sourceId: row.source_id,
          sourceKey: row.source_key,
          surface: row.surface,
          externalReference: row.external_reference,
          title: row.title,
          email: row.email,
          stage: row.stage,
          operationalStatus: row.status,
          ownerSubjectId: row.owner_subject_id,
          stageEnteredAt: new Date(row.stage_entered_at).toISOString(),
          closeReasonCode: row.close_reason_code,
          closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
          projectedToCrm: row.projected_to_crm,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        })),
      }, { headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (error) {
    console.error('Brand Demand Capture inbox read failed:', error);
    return NextResponse.json({ error: 'Unable to load Demand Capture leads.' }, { status: 500 });
  }
}
