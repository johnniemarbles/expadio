import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STAGES = new Set([
  'NEW_ENQUIRY','CONTACT_ATTEMPTED','CONTACTED','QUALIFICATION','QUALIFIED',
  'DISCOVERY_SCHEDULED','DISCOVERY_COMPLETED','OPPORTUNITY_EVALUATION',
  'APPLICATION_INVITED','APPLICATION_STARTED','APPLICATION_SUBMITTED','DUE_DILIGENCE',
  'APPROVAL','AGREEMENT','ACTIVATION','WON','LOST','DISQUALIFIED','NURTURE',
]);
const TERMINAL = new Set(['WON','LOST','DISQUALIFIED']);

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max || /[\0\r]/u.test(trimmed)) throw new Error('INVALID_TEXT');
  return trimmed;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });

    const body = await request.json();
    const targetStage = typeof body.stage === 'string' ? body.stage.trim().toUpperCase() : '';
    if (!STAGES.has(targetStage)) return NextResponse.json({ error: 'Unknown target capture stage.' }, { status: 400 });
    let reason: string | null;
    let closeReasonCode: string | null;
    try {
      reason = boundedString(body.reason, 1000);
      closeReasonCode = boundedString(body.closeReasonCode, 120);
    } catch {
      return NextResponse.json({ error: 'Transition reason is invalid.' }, { status: 400 });
    }
    if (TERMINAL.has(targetStage) && !closeReasonCode) {
      return NextResponse.json({
        denied: true,
        reasonKey: 'CLOSE_REASON_REQUIRED',
        message: 'A close reason is required for terminal Demand Capture stages.',
      }, { status: 409 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, {
        tenantId: context.tenantId,
        moduleKey: 'lead-management',
      });
      if (module?.availability !== 'ACTIVE') {
        return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      }

      const current = await client.query<{ organization_id: string; stage: string; status: string }>(
        `SELECT organization_id, stage, status
           FROM platform.lead_capture_leads
          WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
          FOR UPDATE`,
        [context.tenantId, captureLeadId],
      );
      const row = current.rows[0];
      if (!row) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      if (row.stage === targetStage) {
        return NextResponse.json({
          success: true,
          replayed: true,
          captureLeadId,
          stage: row.stage,
          operationalStatus: row.status,
        });
      }
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, row.organization_id)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      await client.query(
        `SELECT set_config('app.lead_capture_transition_actor', $1, true),
                set_config('app.lead_capture_transition_reason', $2, true),
                set_config('app.lead_capture_close_reason', $3, true)`,
        [context.subjectId, reason ?? '', closeReasonCode ?? ''],
      );

      await client.query('SAVEPOINT governed_capture_stage');
      let updated;
      try {
        updated = await client.query<{
          capture_lead_id: string; stage: string; status: string;
          stage_entered_at: Date | string; close_reason_code: string | null; closed_at: Date | string | null;
        }>(
          `UPDATE platform.lead_capture_leads
              SET stage = $3,
                  updated_at = now()
            WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
            RETURNING capture_lead_id, stage, status, stage_entered_at, close_reason_code, closed_at`,
          [context.tenantId, captureLeadId, targetStage],
        );
        await client.query('RELEASE SAVEPOINT governed_capture_stage');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT governed_capture_stage');
        await client.query('RELEASE SAVEPOINT governed_capture_stage');
        const code = (error as { code?: string }).code;
        const message = error instanceof Error ? error.message : '';
        if (code === '23514' && message.includes('requires reason')) {
          return NextResponse.json({
            denied: true,
            reasonKey: 'TRANSITION_REASON_REQUIRED',
            message: 'Skipping, reversing, nurturing, or reopening a stage requires an explicit reason.',
          }, { status: 409 });
        }
        if (code === '23514' && message.includes('close reason')) {
          return NextResponse.json({ denied: true, reasonKey: 'CLOSE_REASON_REQUIRED' }, { status: 409 });
        }
        throw error;
      }

      const changed = updated.rows[0];
      if (!changed) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      const history = await client.query<{
        stage_history_id: string; from_stage: string; to_stage: string; transition_kind: string;
        reason: string | null; close_reason_code: string | null; duration_in_previous_seconds: string | number;
        changed_at: Date | string;
      }>(
        `SELECT stage_history_id, from_stage, to_stage, transition_kind,
                reason, close_reason_code, duration_in_previous_seconds, changed_at
           FROM platform.lead_capture_stage_history
          WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
          ORDER BY changed_at DESC, stage_history_id DESC
          LIMIT 1`,
        [context.tenantId, captureLeadId],
      );
      const event = history.rows[0];
      return NextResponse.json({
        success: true,
        replayed: false,
        captureLeadId,
        stage: changed.stage,
        operationalStatus: changed.status,
        stageEnteredAt: new Date(changed.stage_entered_at).toISOString(),
        closeReasonCode: changed.close_reason_code,
        closedAt: changed.closed_at ? new Date(changed.closed_at).toISOString() : null,
        transition: event ? {
          stageHistoryId: event.stage_history_id,
          fromStage: event.from_stage,
          toStage: event.to_stage,
          transitionKind: event.transition_kind,
          reason: event.reason,
          closeReasonCode: event.close_reason_code,
          durationInPreviousSeconds: Number(event.duration_in_previous_seconds),
          changedAt: new Date(event.changed_at).toISOString(),
        } : null,
      });
    });
  } catch (error) {
    console.error('Brand Demand Capture stage transition failed:', error);
    return NextResponse.json({ error: 'Unable to change Demand Capture stage.' }, { status: 500 });
  }
}
