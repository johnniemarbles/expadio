import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../../lib/governance-authz';
import {
  GTM_EMAIL_CONNECTOR_KEY,
  GtmSendGateError,
  assertConnectorReady,
  buildGtmCommunicationIntent,
} from '../../../../../../lib/gtm-communication';

/**
 * File a Communication intent for an approved sequence touch.
 * Does not send. gtm.email stays dark until a tenant enables BYOC.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const sequenceId = decodeURIComponent((await params).id);
    const body = await request.json();
    const stepKey = typeof body?.stepKey === 'string' ? body.stepKey.trim() : 'touch-1';
    const subject = typeof body?.subject === 'string' ? body.subject : '';
    const text = typeof body?.body === 'string' ? body.body : '';
    const recipientEmail = typeof body?.recipientEmail === 'string' ? body.recipientEmail : '';
    const recipientSubjectId = typeof body?.recipientSubjectId === 'string' ? body.recipientSubjectId : undefined;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const sequence = await client.query(
        `SELECT sequence_id, tenant_id, author_subject_id, stage_key, status
           FROM platform.gtm_sequences
          WHERE sequence_id = $1::uuid`,
        [sequenceId],
      );
      if (sequence.rows.length === 0) return { notFound: true } as const;
      const row = sequence.rows[0];

      const connector = await client.query(
        `SELECT connector_key, enabled, provider_key
           FROM platform.connectors
          WHERE connector_key = $1`,
        [GTM_EMAIL_CONNECTOR_KEY],
      );
      const connectorRow = connector.rows[0] as
        | { connector_key: string; enabled: boolean; provider_key: string }
        | undefined;

      try {
        assertConnectorReady(
          connectorRow
            ? {
                connectorKey: connectorRow.connector_key,
                enabled: connectorRow.enabled,
                providerKey: connectorRow.provider_key,
              }
            : null,
        );
        const intent = buildGtmCommunicationIntent({
          touch: {
            sequenceId: row.sequence_id,
            stepKey,
            tenantId: row.tenant_id,
            subject,
            body: text,
            recipientEmail,
            recipientSubjectId,
            stageKey: row.stage_key,
            authorSubjectId: row.author_subject_id,
          },
          actorSubjectId: context.subjectId,
        });
        return { intent } as const;
      } catch (cause) {
        if (cause instanceof GtmSendGateError) {
          return { denied: true as const, code: cause.code, message: cause.message };
        }
        throw cause;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a governing role to file a Communication intent.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That sequence was not found in this workspace.' }, { status: 404 });
    }
    if ('denied' in result) {
      const status = result.code === 'SEPARATION_OF_DUTIES' ? 403 : 409;
      return NextResponse.json({
        denied: true,
        reasonKey: result.code,
        message: result.message,
        sent: false,
      }, { status });
    }
    return NextResponse.json({
      success: true,
      sent: false,
      reasonKey: 'INTENT_FILED_CONNECTOR_NOT_DISPATCHED',
      intent: result.intent,
    }, { status: 202 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
