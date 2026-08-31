import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';

/** Tenant-scoped meeting requests. POST files a request bound to gtm.meeting_request. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT meeting_request_id, brand_id, campaign_id, reply_id, prospect_email,
                summary, status, blueprint_key, workflow_instance_id, stage_key, created_at
           FROM platform.gtm_meeting_requests
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return result.rows;
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const prospectEmail = typeof body?.prospectEmail === 'string' ? body.prospectEmail.trim() : '';
    const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 });
    }
    if (!prospectEmail.includes('@')) {
      return NextResponse.json({ error: 'prospectEmail is required.' }, { status: 400 });
    }
    if (summary === '' || summary.length > 400) {
      return NextResponse.json({ error: 'A summary (1–400 characters) is required.' }, { status: 400 });
    }
    const campaignId = typeof body?.campaignId === 'string' && body.campaignId.trim() !== '' ? body.campaignId : null;
    const replyId = typeof body?.replyId === 'string' && body.replyId.trim() !== '' ? body.replyId : null;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const inserted = await client.query(
        `INSERT INTO platform.gtm_meeting_requests
           (tenant_id, brand_id, campaign_id, reply_id, prospect_email, summary, status, blueprint_key)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'requested', 'gtm.meeting_request')
         RETURNING meeting_request_id`,
        [context.tenantId, brandId, campaignId, replyId, prospectEmail, summary],
      );
      return { meetingRequestId: inserted.rows[0].meeting_request_id as string } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to file a meeting request.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, meetingRequestId: result.meetingRequestId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
