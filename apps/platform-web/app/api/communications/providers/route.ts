import { requireCommunicationAdmin } from '../../../../lib/communication-admin';
import { consumeIntakeReceipt, IntakeReceiptRequired } from '../../../../lib/communication-intake-receipt';
import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import {
  resolveRequestContext,
  requireStepUp,
  withTenantTransaction,
  deniedResponse,
} from '../../../../lib/request-context';

/**
 * Platform-owned Communications: only verified platform administrators may
 * inspect or register providers. Existing tenant connectors are retained for
 * migration, but all new registrations are shared PLATFORM connections.
 *
 * The response type below has no field capable of holding a secret. That is a
 * contract, not an implementation detail (§8).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ConnectorListItem {
  connectorKey: string;
  providerType: string;
  providerKey: string;
  ownershipScope: 'PLATFORM' | 'TENANT';
  custodyMode: 'PLATFORM_MANAGED' | 'DELEGATED' | 'CUSTOMER_REFERENCED' | 'CUSTOMER_EGRESS';
  /** §2.3 — HMAC-derived. Confirms identity, discloses nothing. Never a mask. */
  fingerprint: string | null;
  credentialState: string | null;
  probeStatus: string | null;
  probeCheckedAt: string | null;
  probeError: string | null;
  probeWarnings: unknown[];
  failurePolicy: string | null;
  health: string;
  enabled: boolean;
  region: string | null;
  capabilityKeys: string[];
  hasCredential: boolean;
}

const SUPPORTED_PROVIDER_KEYS = new Set([
  'ses', 'sendgrid', 'resend', 'postmark', 'mailgun', 'smtp',
  'twilio-sms', 'twilio-whatsapp', 'twilio-voice', 'vonage-sms',
  'vonage-voice', 'messagebird-sms', 'messagebird-whatsapp', '360dialog',
  'firebase', 'apns', 'web-push',
]);

const CHANNELS = new Set(['email', 'sms', 'whatsapp', 'voice', 'push', 'rcs']);

function isSecretReference(value: unknown): value is string {
  return typeof value === 'string'
    && /^(kms|vault|secret|provider-secret):\/\/[^\s]+$/.test(value)
    && value.length < 512;
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);

    const connectors = await withTenantTransaction(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const result = await client.query(
        `SELECT
           c.connector_key, c.provider_type, c.provider_key, c.ownership_scope,
           c.health, c.enabled, c.region,
           COALESCE(ARRAY_AGG(DISTINCT cap.capability_key)
             FILTER (WHERE cap.capability_key IS NOT NULL), '{}') AS capability_keys,
           cred.custody_mode, cred.fingerprint, cred.state AS credential_state,
           cred.probe_status, cred.probe_checked_at, cred.probe_error,
           cred.probe_warnings, cred.failure_policy,
           (cred.credential_id IS NOT NULL) AS has_credential
         FROM platform.connectors c
         LEFT JOIN platform.connector_capabilities cc ON cc.connector_id = c.connector_id
         LEFT JOIN platform.capabilities cap ON cap.capability_id = cc.capability_id
         LEFT JOIN LATERAL (
           SELECT * FROM platform.connector_credentials cr
            WHERE cr.connector_id = c.connector_id
              AND cr.state <> 'SUPERSEDED'
            ORDER BY cr.created_at DESC LIMIT 1
         ) cred ON true
         WHERE (c.tenant_id IS NULL OR c.tenant_id = $1::uuid)
           AND c.provider_type IN ('email','sms','whatsapp','voice','push','rcs')
         GROUP BY c.connector_id, cred.credential_id, cred.custody_mode, cred.fingerprint,
                  cred.state, cred.probe_status, cred.probe_checked_at, cred.probe_error,
                  cred.probe_warnings, cred.failure_policy
         ORDER BY c.priority, c.connector_key`,
        [context.tenantId],
      );

      return result.rows.map((row): ConnectorListItem => ({
        connectorKey: row.connector_key,
        providerType: row.provider_type,
        providerKey: row.provider_key,
        ownershipScope: row.ownership_scope,
        custodyMode: row.custody_mode ?? 'PLATFORM_MANAGED',
        fingerprint: row.fingerprint ?? null,
        credentialState: row.credential_state ?? null,
        probeStatus: row.probe_status ?? null,
        probeCheckedAt: row.probe_checked_at?.toISOString?.() ?? null,
        probeError: row.probe_error ?? null,
        probeWarnings: row.probe_warnings ?? [],
        failurePolicy: row.failure_policy ?? null,
        health: row.health,
        enabled: row.enabled,
        region: row.region ?? null,
        capabilityKeys: row.capability_keys,
        hasCredential: row.has_credential === true,
      }));
    });

    return NextResponse.json(connectors);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);
    await requireStepUp();

    const body = await request.json();

    const providerKey = typeof body.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';
    const providerType = typeof body.providerType === 'string' ? body.providerType.trim().toLowerCase() : '';
    const credentialRef = body.credentialRef;

    if (body.ownershipScope !== undefined && body.ownershipScope !== 'PLATFORM') {
      return NextResponse.json({ error: 'Communication providers must be platform-owned.' }, { status: 400 });
    }
    const ownershipScope = 'PLATFORM';

    const custodyMode = typeof body.custodyMode === 'string' ? body.custodyMode : 'DELEGATED';
    const failurePolicy = typeof body.failurePolicy === 'string' ? body.failurePolicy : 'HOLD_AND_RETRY';

    const connectorKey = typeof body.connectorKey === 'string' && body.connectorKey.trim() !== ''
      ? body.connectorKey.trim()
      : `comm-${providerKey}-${crypto.randomUUID()}`;

    const region = typeof body.region === 'string' && body.region.trim() !== '' ? body.region.trim() : null;
    const priority = Number.isInteger(body.priority) && body.priority >= 0 ? body.priority : 100;

    const capabilityKeys: string[] = Array.isArray(body.capabilityKeys)
      ? body.capabilityKeys.filter((k: unknown): k is string => typeof k === 'string' && k.trim() !== '')
      : [];

    if (!SUPPORTED_PROVIDER_KEYS.has(providerKey)) {
      return NextResponse.json({ error: 'That communication provider is not supported.' }, { status: 400 });
    }
    if (!CHANNELS.has(providerType)) {
      return NextResponse.json({ error: 'That communication channel is not supported.' }, { status: 400 });
    }
    if (!['DELEGATED', 'CUSTOMER_EGRESS'].includes(custodyMode)) {
      return NextResponse.json({ error: 'This registration flow requires verified delegated intake, or a disabled egress placeholder.' }, { status: 400 });
    }
    if (!['HOLD_AND_RETRY', 'FALLBACK_TRANSACTIONAL', 'REFUSE_IMMEDIATELY'].includes(failurePolicy)) {
      return NextResponse.json({ error: 'Unknown failure policy.' }, { status: 400 });
    }
    if (custodyMode !== 'CUSTOMER_EGRESS' && !isSecretReference(credentialRef)) {
      return NextResponse.json(
        {
          error:
            'credentialRef must be an external secret reference (kms://, vault://, secret:// or provider-secret://). Use POST /custody/credentials to obtain one.',
        },
        { status: 400 },
      );
    }
    if (capabilityKeys.length === 0) {
      return NextResponse.json({ error: 'At least one capability is required.' }, { status: 400 });
    }

    const created = await withTenantTransaction(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      try {
        const receipt = custodyMode === 'DELEGATED'
          ? await consumeIntakeReceipt(client, {
            receiptId: body.intakeReceiptId, tenantId: context.tenantId, subjectId: context.subjectId,
            connectorKey, providerKey, credentialRef,
          }) : null;
        if (receipt && capabilityKeys.some(key => !key.startsWith(`communication.${providerType}.`)
          || !receipt.detected_capabilities.includes(key.replace(/^communication\./, '')))) {
          throw new IntakeReceiptRequired();
        }
        const connector = await client.query(
          `INSERT INTO platform.connectors
             (connector_key, provider_type, provider_key, ownership_scope, tenant_id,
              region, priority, enabled, fallback_enabled)
           VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, false, false)
           RETURNING connector_id, connector_key, provider_type, provider_key,
                     ownership_scope, region, priority, enabled, health, created_at`,
          [
            connectorKey,
            providerType,
            providerKey,
            ownershipScope,
            null,
            region,
            priority,
          ],
        );

        const connectorId = connector.rows[0].connector_id;

        for (const capabilityKey of capabilityKeys) {
          const capability = await client.query(
            `SELECT capability_id FROM platform.capabilities
              WHERE capability_key = $1 AND enabled = true`,
            [capabilityKey],
          );
          if (capability.rows.length === 0) {
            throw new Error(`Unknown or disabled capability: ${capabilityKey}`);
          }
          await client.query(
            `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
             VALUES ($1, $2)`,
            [connectorId, capability.rows[0].capability_id],
          );
        }

        if (receipt) {
          await client.query(
            `INSERT INTO platform.connector_credentials
               (connector_id, credential_ref, key_version, custody_mode, fingerprint,
                state, probe_status, probe_checked_at, probe_warnings,
                detected_capabilities, failure_policy, hold_window_seconds,
                intake_receipt_id, rotated_at)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'VALID', $11::timestamptz, $6::jsonb,
                     $7::text[], $8, $9, $10::uuid, now())`,
            [
              connectorId,
              receipt.credential_ref,
              receipt.key_version,
              custodyMode,
              receipt.fingerprint,
              JSON.stringify(receipt.probe_warnings),
              receipt.detected_capabilities,
              failurePolicy,
              Number.isInteger(body.holdWindowSeconds) ? body.holdWindowSeconds : 900,
              receipt.receipt_id,
              receipt.probed_at,
            ],
          );
        }

        return connector.rows[0];
      } catch (error) {
        throw error;
      }
    });

    return NextResponse.json({ success: true, connector: created }, { status: 201 });
  } catch (error) {
    if (error instanceof IntakeReceiptRequired) {
      return NextResponse.json({ error: error.message, reasonKey: 'VERIFIED_INTAKE_REQUIRED' }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith('Unknown or disabled capability')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const { body, status } = deniedResponse(error);
    const denied = body as DeniedResult;
    return NextResponse.json(denied, { status });
  }
}
