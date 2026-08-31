import { NextResponse } from 'next/server';
import { OUTBOUND_GTM_LEAD_SOURCE } from '@expadio/lead';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';
import { isReplyClass, shouldConvertReplyToLead } from '../../../../lib/gtm-communication';

/**
 * Ingest a warm-reply observation. Capture classes also file a CRM lead with
 * source outbound_gtm and raw_payload first. Not a second CRM.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT reply_id, brand_id, campaign_id, from_email, proposed_class, payload, created_at
           FROM platform.gtm_reply_observations
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
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
    const fromEmail = typeof body?.fromEmail === 'string' ? body.fromEmail.trim() : '';
    const proposedClass = typeof body?.proposedClass === 'string' ? body.proposedClass.trim() : '';
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 });
    }
    if (!fromEmail.includes('@')) {
      return NextResponse.json({ error: 'fromEmail is required.' }, { status: 400 });
    }
    if (!isReplyClass(proposedClass)) {
      return NextResponse.json({ error: 'proposedClass is not a known reply class.' }, { status: 400 });
    }
    const campaignId = typeof body?.campaignId === 'string' && body.campaignId.trim() !== '' ? body.campaignId : null;
    const rawPayload = body?.rawPayload && typeof body.rawPayload === 'object' && !Array.isArray(body.rawPayload)
      ? body.rawPayload as Record<string, unknown>
      : {};

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const payload = {
        ...rawPayload,
        source: OUTBOUND_GTM_LEAD_SOURCE,
        fromEmail,
        proposedClass,
      };
      const inserted = await client.query(
        `INSERT INTO platform.gtm_reply_observations
           (tenant_id, brand_id, campaign_id, from_email, proposed_class, payload)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
         RETURNING reply_id`,
        [context.tenantId, brandId, campaignId, fromEmail, proposedClass, JSON.stringify(payload)],
      );
      const replyId = inserted.rows[0].reply_id as string;

      let leadId: string | null = null;
      if (shouldConvertReplyToLead(proposedClass)) {
        const lead = await client.query(
          `INSERT INTO platform.crm_leads
             (tenant_id, title, stage, source, raw_payload, owner_subject_id)
           VALUES ($1::uuid, $2, 'NEW', $3, $4::jsonb, $5)
           RETURNING lead_id`,
          [
            context.tenantId,
            `Warm reply — ${fromEmail}`.slice(0, 200),
            OUTBOUND_GTM_LEAD_SOURCE,
            JSON.stringify(payload),
            context.subjectId,
          ],
        );
        leadId = lead.rows[0].lead_id as string;
      }
      return { replyId, leadId } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to ingest a reply.' }, { status: 403 });
    }
    return NextResponse.json({
      success: true,
      replyId: result.replyId,
      leadId: result.leadId,
      captured: result.leadId !== null,
    }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
