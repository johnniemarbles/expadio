import { NextResponse } from 'next/server';
import { OUTBOUND_GTM_LEAD_SOURCE } from '@expadio/lead';
import { ContextDenied, resolveRequestContext, withTenantClient, withTenantTransaction, deniedResponse } from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';
import { isReplyClass, shouldConvertReplyToLead } from '../../../../lib/gtm-communication';
import { classifyReplyBody } from '../../../../lib/gtm-engines';

/**
 * Ingest a warm-reply observation. Capture classes also file a CRM lead with
 * source outbound_gtm and raw_payload first. Not a second CRM.
 * Classification comes from @expadio/gtm, not the console regex.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function replyBodyText(rawPayload: Record<string, unknown>): string {
  if (typeof rawPayload.body === 'string') return rawPayload.body;
  if (typeof rawPayload.text === 'string') return rawPayload.text;
  return '';
}

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
    if (!context.organizationId) {
      throw new ContextDenied('ORGANIZATION_CONTEXT_REQUIRED', 'Select an organization workspace to ingest a reply.', 403);
    }
    const body = await request.json();
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
    const fromEmail = typeof body?.fromEmail === 'string' ? body.fromEmail.trim() : '';
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 });
    }
    if (!fromEmail.includes('@')) {
      return NextResponse.json({ error: 'fromEmail is required.' }, { status: 400 });
    }
    const campaignId =
      typeof body?.campaignId === 'string' && body.campaignId.trim() !== '' ? body.campaignId : null;
    const rawPayload =
      body?.rawPayload && typeof body.rawPayload === 'object' && !Array.isArray(body.rawPayload)
        ? (body.rawPayload as Record<string, unknown>)
        : {};
    const classified = classifyReplyBody(replyBodyText(rawPayload));
    const clientClass = typeof body?.proposedClass === 'string' ? body.proposedClass.trim() : '';
    const proposedClass =
      classified.proposedClass !== 'unknown'
        ? classified.proposedClass
        : isReplyClass(clientClass)
          ? clientClass
          : 'unknown';

    // Observation and optional Lead are one transaction. If the Lead cannot be
    // created under organization RLS, the observation rolls back too: no orphan
    // reply records and no duplicate observations on retry.
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const payload = {
        ...rawPayload,
        source: OUTBOUND_GTM_LEAD_SOURCE,
        fromEmail,
        proposedClass,
        classifier: {
          version: 'gtm-reply-v1',
          proposedClass: classified.proposedClass,
          confidence: classified.confidence,
        },
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
             (tenant_id, organization_id, title, stage, source, raw_payload, owner_subject_id)
           VALUES ($1::uuid, $2::uuid, $3, 'NEW', $4, $5::jsonb, $6)
           RETURNING lead_id`,
          [
            context.tenantId,
            context.organizationId,
            `Warm reply — ${fromEmail}`.slice(0, 200),
            OUTBOUND_GTM_LEAD_SOURCE,
            JSON.stringify(payload),
            context.subjectId,
          ],
        );
        leadId = lead.rows[0].lead_id as string;
      }
      return { replyId, leadId, proposedClass, confidence: classified.confidence } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to ingest a reply.' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        success: true,
        replyId: result.replyId,
        leadId: result.leadId,
        captured: result.leadId !== null,
        proposedClass: result.proposedClass,
        confidence: result.confidence,
      },
      { status: 201 },
    );
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
