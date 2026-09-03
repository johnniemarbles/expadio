import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const captureLeadId = (await params).id.trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'A valid capture lead id is required.' }, { status: 400 });
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT activity_id, activity_type, actor_subject_id, body, metadata, occurred_at
           FROM platform.lead_activities
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid
          ORDER BY occurred_at DESC, activity_id DESC
          LIMIT 500`,
        [context.tenantId, context.organizationId, captureLeadId],
      );
      return NextResponse.json({ activities: result.rows.map((row) => ({
        activityId: row.activity_id,
        activityType: row.activity_type,
        actorSubjectId: row.actor_subject_id,
        body: row.body,
        metadata: row.metadata ?? {},
        occurredAt: new Date(row.occurred_at).toISOString(),
      })) });
    });
  } catch (error) {
    console.error('Lead activity read failed:', error);
    return NextResponse.json({ error: 'Unable to load the activity timeline.' }, { status: 500 });
  }
}

const ALLOWED_POST_TYPES = new Set(['NOTE', 'DISCOVERY', 'COMMUNICATION']);

function buildActivityInsert(activityType: string, body: Record<string, unknown>): { text: string | null; metadata: Record<string, unknown> } {
  if (activityType === 'NOTE') {
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    return { text: text || null, metadata: {} };
  }
  if (activityType === 'DISCOVERY') {
    const meta: Record<string, unknown> = {};
    if (typeof body.durationMinutes === 'number' && body.durationMinutes > 0) meta.duration_minutes = Math.floor(body.durationMinutes);
    const outcome = typeof body.outcome === 'string' ? body.outcome.trim().slice(0, 100) : null;
    if (outcome) meta.outcome = outcome;
    return { text: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 5000) : null, metadata: meta };
  }
  // COMMUNICATION
  const meta: Record<string, unknown> = {};
  const channel = typeof body.channel === 'string' ? body.channel.trim().toUpperCase() : null;
  if (channel) meta.channel = channel;
  const direction = typeof body.direction === 'string' ? body.direction.trim().toUpperCase() : null;
  if (direction === 'INBOUND' || direction === 'OUTBOUND') meta.direction = direction;
  return { text: typeof body.body === 'string' && body.body.trim() ? body.body.trim().slice(0, 5000) : null, metadata: meta };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const captureLeadId = (await params).id.trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'A valid capture lead id is required.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const activityType = typeof body.activityType === 'string' ? body.activityType.trim().toUpperCase() : 'NOTE';
    if (!ALLOWED_POST_TYPES.has(activityType)) {
      return NextResponse.json({ error: `activityType must be one of: ${[...ALLOWED_POST_TYPES].join(', ')}.` }, { status: 400 });
    }
    const { text, metadata } = buildActivityInsert(activityType, body as Record<string, unknown>);
    if (activityType === 'NOTE' && (!text || text.length > 5000)) {
      return NextResponse.json({ error: 'A note body (1-5000 chars) is required.' }, { status: 400 });
    }
    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      // Confirm the lead is in the authorized subtree before anchoring the activity.
      const lead = await client.query(
        `SELECT 1 FROM platform.lead_capture_leads WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid`,
        [context.tenantId, context.organizationId, captureLeadId],
      );
      if (lead.rowCount === 0) return NextResponse.json({ error: 'Capture lead not found.' }, { status: 404 });
      const inserted = await client.query(
        `INSERT INTO platform.lead_activities
           (tenant_id, organization_id, capture_lead_id, activity_type, actor_subject_id, body, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)
         RETURNING activity_id, occurred_at`,
        [context.tenantId, context.organizationId, captureLeadId, activityType, context.subjectId, text, JSON.stringify(metadata)],
      );
      return NextResponse.json({
        success: true,
        activityId: inserted.rows[0].activity_id,
        activityType,
        occurredAt: new Date(inserted.rows[0].occurred_at).toISOString(),
      }, { status: 201 });
    });
  } catch (error) {
    console.error('Lead activity creation failed:', error);
    return NextResponse.json({ error: 'Unable to add the activity.' }, { status: 500 });
  }
}
