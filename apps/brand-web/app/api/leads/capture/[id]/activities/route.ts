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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const captureLeadId = (await params).id.trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'A valid capture lead id is required.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const noteBody = typeof body.body === 'string' ? body.body.trim() : '';
    if (!noteBody || noteBody.length > 5000) {
      return NextResponse.json({ error: 'A note body (1-5000 chars) is required.' }, { status: 400 });
    }
    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      // Confirm the lead is in the authorized subtree before anchoring a note.
      const lead = await client.query(
        `SELECT 1 FROM platform.lead_capture_leads WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid`,
        [context.tenantId, context.organizationId, captureLeadId],
      );
      if (lead.rowCount === 0) return NextResponse.json({ error: 'Capture lead not found.' }, { status: 404 });
      const inserted = await client.query(
        `INSERT INTO platform.lead_activities
           (tenant_id, organization_id, capture_lead_id, activity_type, actor_subject_id, body)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'NOTE', $4, $5)
         RETURNING activity_id, occurred_at`,
        [context.tenantId, context.organizationId, captureLeadId, context.subjectId, noteBody],
      );
      return NextResponse.json({ success: true, activityId: inserted.rows[0].activity_id, occurredAt: new Date(inserted.rows[0].occurred_at).toISOString() }, { status: 201 });
    });
  } catch (error) {
    console.error('Lead note creation failed:', error);
    return NextResponse.json({ error: 'Unable to add the note.' }, { status: 500 });
  }
}
