import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });

    return await withBrandTransaction(context, async (client) => {
      const lead = await client.query(
        `SELECT l.capture_lead_id, l.organization_id, l.source_id, s.source_key, s.surface,
                s.layer_key, l.external_reference, l.title, l.email, l.stage, l.status,
                l.raw_payload, l.owner_subject_id, l.stage_entered_at, l.status_entered_at,
                l.close_reason_code, l.closed_at, l.created_at, l.updated_at,
                c.lead_id AS crm_lead_id, c.stage AS crm_stage
           FROM platform.lead_capture_leads l
           JOIN platform.lead_capture_sources s
             ON s.tenant_id = l.tenant_id AND s.source_id = l.source_id
           LEFT JOIN platform.crm_leads c
             ON c.tenant_id = l.tenant_id AND c.capture_lead_id = l.capture_lead_id
          WHERE l.tenant_id = $1::uuid AND l.capture_lead_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, captureLeadId],
      );
      const row = lead.rows[0];
      if (!row) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });

      const [stageHistory, statusHistory] = await Promise.all([
        client.query(
          `SELECT stage_history_id, from_stage, to_stage, transition_kind,
                  actor_subject_id, reason, close_reason_code,
                  duration_in_previous_seconds, changed_at
             FROM platform.lead_capture_stage_history
            WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
            ORDER BY changed_at DESC, stage_history_id DESC`,
          [context.tenantId, captureLeadId],
        ),
        client.query(
          `SELECT status_history_id, from_status, to_status, actor_subject_id,
                  reason, duration_in_previous_seconds, changed_at
             FROM platform.lead_capture_status_history
            WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
            ORDER BY changed_at DESC, status_history_id DESC`,
          [context.tenantId, captureLeadId],
        ),
      ]);

      return NextResponse.json({
        captureLeadId: row.capture_lead_id,
        organizationId: row.organization_id,
        source: { sourceId: row.source_id, sourceKey: row.source_key, surface: row.surface, layerKey: row.layer_key },
        externalReference: row.external_reference,
        title: row.title,
        email: row.email,
        stage: row.stage,
        operationalStatus: row.status,
        ownerSubjectId: row.owner_subject_id,
        rawPayload: row.raw_payload,
        stageEnteredAt: new Date(row.stage_entered_at).toISOString(),
        statusEnteredAt: new Date(row.status_entered_at).toISOString(),
        closeReasonCode: row.close_reason_code,
        closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
        crmProjection: row.crm_lead_id ? { leadId: row.crm_lead_id, stage: row.crm_stage } : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        stageHistory: stageHistory.rows.map((item) => ({
          stageHistoryId: item.stage_history_id,
          fromStage: item.from_stage,
          toStage: item.to_stage,
          transitionKind: item.transition_kind,
          actorSubjectId: item.actor_subject_id,
          reason: item.reason,
          closeReasonCode: item.close_reason_code,
          durationInPreviousSeconds: Number(item.duration_in_previous_seconds),
          changedAt: new Date(item.changed_at).toISOString(),
        })),
        statusHistory: statusHistory.rows.map((item) => ({
          statusHistoryId: item.status_history_id,
          fromStatus: item.from_status,
          toStatus: item.to_status,
          actorSubjectId: item.actor_subject_id,
          reason: item.reason,
          durationInPreviousSeconds: Number(item.duration_in_previous_seconds),
          changedAt: new Date(item.changed_at).toISOString(),
        })),
      }, { headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (error) {
    console.error('Brand Demand Capture detail read failed:', error);
    return NextResponse.json({ error: 'Unable to load Demand Capture Lead.' }, { status: 500 });
  }
}
