import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATUSES = new Set([
  'ACTIVE','WAITING_ON_LEAD','WAITING_INTERNAL','ON_HOLD','STALLED',
  'DISQUALIFIED','CONVERTED','LOST','ARCHIVED',
]);
const TERMINAL_STAGE_STATUS = new Map([
  ['WON', 'CONVERTED'],
  ['LOST', 'LOST'],
  ['DISQUALIFIED', 'DISQUALIFIED'],
]);

function reasonString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1000 || /[\0\r]/u.test(trimmed)) return null;
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
    const targetStatus = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    const reason = reasonString(body.reason);
    if (!STATUSES.has(targetStatus)) return NextResponse.json({ error: 'Unknown operational status.' }, { status: 400 });
    if (!reason) {
      return NextResponse.json({ denied: true, reasonKey: 'STATUS_REASON_REQUIRED', message: 'Operational status changes require a reason.' }, { status: 409 });
    }

    return await withBrandTransaction(context, async (client) => {
      const current = await client.query<{ organization_id: string; stage: string; status: string }>(
        `SELECT organization_id, stage, status
           FROM platform.lead_capture_leads
          WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
          FOR UPDATE`,
        [context.tenantId, captureLeadId],
      );
      const row = current.rows[0];
      if (!row) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      if (row.status === targetStatus) {
        return NextResponse.json({ success: true, replayed: true, captureLeadId, stage: row.stage, operationalStatus: row.status });
      }
      const forcedTerminalStatus = TERMINAL_STAGE_STATUS.get(row.stage);
      if (forcedTerminalStatus && targetStatus !== forcedTerminalStatus) {
        return NextResponse.json({
          denied: true,
          reasonKey: 'TERMINAL_STAGE_STATUS_LOCKED',
          message: `Stage ${row.stage} requires operational status ${forcedTerminalStatus}. Reopen the journey stage first.`,
        }, { status: 409 });
      }
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, row.organization_id)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      await client.query(
        `SELECT set_config('app.lead_capture_transition_actor', $1, true),
                set_config('app.lead_capture_transition_reason', $2, true)`,
        [context.subjectId, reason],
      );
      const updated = await client.query<{
        stage: string; status: string; status_entered_at: Date | string;
      }>(
        `UPDATE platform.lead_capture_leads
            SET status = $3, updated_at = now()
          WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
          RETURNING stage, status, status_entered_at`,
        [context.tenantId, captureLeadId, targetStatus],
      );
      const changed = updated.rows[0];
      if (!changed) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });

      const history = await client.query<{
        status_history_id: string; from_status: string; to_status: string;
        reason: string; duration_in_previous_seconds: string | number; changed_at: Date | string;
      }>(
        `SELECT status_history_id, from_status, to_status, reason,
                duration_in_previous_seconds, changed_at
           FROM platform.lead_capture_status_history
          WHERE tenant_id = $1::uuid AND capture_lead_id = $2::uuid
          ORDER BY changed_at DESC, status_history_id DESC
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
        statusEnteredAt: new Date(changed.status_entered_at).toISOString(),
        transition: event ? {
          statusHistoryId: event.status_history_id,
          fromStatus: event.from_status,
          toStatus: event.to_status,
          reason: event.reason,
          durationInPreviousSeconds: Number(event.duration_in_previous_seconds),
          changedAt: new Date(event.changed_at).toISOString(),
        } : null,
      });
    });
  } catch (error) {
    console.error('Brand Demand Capture status transition failed:', error);
    return NextResponse.json({ error: 'Unable to change Demand Capture operational status.' }, { status: 500 });
  }
}
