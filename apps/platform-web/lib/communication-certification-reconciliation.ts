import type { PoolClient } from 'pg';

export type CommunicationCertificationTerminalState =
  | 'DELIVERED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED'
  | 'CANCELLED';

interface CertificationRequestRow {
  readonly certification_request_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly action_intent_id: string;
  readonly delivery_id: string;
  readonly connector_key: string;
  readonly provider_key: string;
  readonly channel: string;
  readonly adapter_key: string;
  readonly capability_key: string;
  readonly commit_sha: string;
  readonly operator_subject_id: string;
}

interface EvidenceRow {
  readonly provider_attempt_id: string;
  readonly provider_message_id: string;
  readonly execution_attempt_id: string;
}

export interface CommunicationCertificationReconciliationResult {
  readonly status: 'NOT_A_CERTIFICATION' | 'CERTIFIED' | 'FAILED';
  readonly certificationId?: string;
}

/**
 * Materialize certification only after the signed provider-webhook boundary has
 * persisted a terminal lifecycle event. Provider acceptance alone never calls
 * this function and can therefore never produce LIVE evidence.
 */
export async function reconcileCommunicationCertification(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly deliveryId: string;
    readonly webhookEventId: string;
    readonly finalDeliveryState: CommunicationCertificationTerminalState;
  },
): Promise<CommunicationCertificationReconciliationResult> {
  const requestResult = await client.query<CertificationRequestRow>(
    `SELECT certification_request_id, tenant_id, organization_id,
            action_intent_id, delivery_id, connector_key, provider_key,
            channel, adapter_key, capability_key, commit_sha,
            operator_subject_id
       FROM platform.communication_certification_requests
      WHERE tenant_id = $1::uuid
        AND delivery_id = $2::uuid
        AND status = 'CERTIFYING'
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.deliveryId],
  );
  const request = requestResult.rows[0];
  if (request === undefined) return { status: 'NOT_A_CERTIFICATION' };

  const evidenceResult = await client.query<EvidenceRow>(
    `SELECT provider_attempt.provider_attempt_id,
            provider_attempt.provider_message_id,
            execution_attempt.execution_attempt_id
       FROM platform.communication_provider_attempts provider_attempt
       JOIN platform.governed_action_execution_attempts execution_attempt
         ON execution_attempt.tenant_id = provider_attempt.tenant_id
        AND execution_attempt.action_intent_id = $3::uuid
        AND execution_attempt.status = 'QUEUED'
      WHERE provider_attempt.tenant_id = $1::uuid
        AND provider_attempt.delivery_id = $2::uuid
        AND provider_attempt.outcome = 'ACCEPTED'
        AND provider_attempt.provider_message_id IS NOT NULL
      ORDER BY provider_attempt.completed_at DESC,
               execution_attempt.completed_at DESC
      LIMIT 1`,
    [input.tenantId, input.deliveryId, request.action_intent_id],
  );
  const evidence = evidenceResult.rows[0];
  if (evidence === undefined) {
    throw new Error('COMMUNICATION_CERTIFICATION_EVIDENCE_INCOMPLETE');
  }

  const live = input.finalDeliveryState === 'DELIVERED';
  if (live) {
    await client.query(
      `UPDATE platform.communication_certifications
          SET status = 'REVOKED',
              failure_reason = 'Superseded by a newer live certification.',
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND connector_key = $2
          AND channel = $3
          AND status = 'LIVE_CERTIFIED'`,
      [input.tenantId, request.connector_key, request.channel],
    );
  }

  const inserted = await client.query<{ readonly certification_id: string }>(
    `INSERT INTO platform.communication_certifications (
       tenant_id, organization_id, connector_key, provider_key, channel,
       adapter_key, capability_key, delivery_id, provider_attempt_id,
       provider_message_id, webhook_event_id, decision_trace_id,
       execution_trace_id, final_delivery_state, commit_sha,
       operator_subject_id, certified_at, status, failure_reason, metadata
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5,
       $6, $7, $8::uuid, $9::uuid,
       $10, $11, NULL,
       $12::uuid, $13, $14,
       $15, now(), $16, $17, $18::jsonb
     )
     RETURNING certification_id`,
    [
      request.tenant_id,
      request.organization_id,
      request.connector_key,
      request.provider_key,
      request.channel,
      request.adapter_key,
      request.capability_key,
      request.delivery_id,
      evidence.provider_attempt_id,
      evidence.provider_message_id,
      input.webhookEventId,
      evidence.execution_attempt_id,
      input.finalDeliveryState,
      request.commit_sha,
      request.operator_subject_id,
      live ? 'LIVE_CERTIFIED' : 'FAILED',
      live ? null : `Provider terminal state: ${input.finalDeliveryState}`,
      JSON.stringify({
        certificationRequestId: request.certification_request_id,
        evidenceSource: 'SIGNED_PROVIDER_WEBHOOK',
      }),
    ],
  );
  const certification = inserted.rows[0];
  if (certification === undefined) {
    throw new Error('COMMUNICATION_CERTIFICATION_INSERT_FAILED');
  }

  await client.query(
    `UPDATE platform.communication_certification_requests
        SET status = $3,
            certification_id = $4::uuid,
            failure_reason = $5,
            completed_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND certification_request_id = $2::uuid
        AND status = 'CERTIFYING'`,
    [
      input.tenantId,
      request.certification_request_id,
      live ? 'LIVE_CERTIFIED' : 'FAILED',
      certification.certification_id,
      live ? null : `Provider terminal state: ${input.finalDeliveryState}`,
    ],
  );

  return {
    status: live ? 'CERTIFIED' : 'FAILED',
    certificationId: certification.certification_id,
  };
}
