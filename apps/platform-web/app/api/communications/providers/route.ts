import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import {
  resolveRequestContext,
  requireStepUp,
  withTenantClient,
  withTenantTransaction,
  deniedResponse,
} from '../../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../../lib/governance-authz';
import { executableCommunicationProvider } from '../../../../lib/communication-runtime-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ConnectorListItem {
  connectorKey: string;
  providerType: string;
  providerKey: string;
  ownershipScope: 'PLATFORM' | 'TENANT';
  custodyMode: 'PLATFORM_MANAGED' | 'DELEGATED' | 'CUSTOMER_REFERENCED' | 'CUSTOMER_EGRESS';
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
  /** True only when the current durable/test-send runtime has a real adapter. */
  runtimeSupported: boolean;
}

const CHANNELS = new Set(['email', 'sms', 'whatsapp', 'voice', 'push', 'rcs']);

function isSecretReference(value: unknown): value is string {
  return typeof value === 'string'
    && /^(kms|vault|secret|provider-secret):\/\/[^\s]+$/.test(value)
    && value.length < 512;
}

export async function GET() {
  try {
    const context = await resolveRequestContext();

    const connectors = await withTenantClient(context, async (client) => {
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
        runtimeSupported: executableCommunicationProvider(row.provider_key, row.provider_type) !== null,
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
    const context = await resolveRequestContext();
    await requireStepUp();
    const platformAuthorized = await withTenantTransaction(
      context,
      (client) => hasPlatformAdministrationRole(client, context.subjectId),
    );
    if (!platformAuthorized) {
      return NextResponse.json(
        { denied: true, reasonKey: 'PLATFORM_ADMIN_REQUIRED', message: 'Only Platform Administration can configure provider infrastructure.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const providerKey = typeof body.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';
    const providerType = typeof body.providerType === 'string' ? body.providerType.trim().toLowerCase() : '';
    const credentialRef = body.credentialRef;
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim() : null;
    const ownershipScope: 'PLATFORM' = 'PLATFORM';
    const custodyMode = typeof body.custodyMode === 'string' ? body.custodyMode : 'DELEGATED';
    const failurePolicy = typeof body.failurePolicy === 'string' ? body.failurePolicy : 'HOLD_AND_RETRY';
    const connectorKey = typeof body.connectorKey === 'string' && body.connectorKey.trim() !== ''
      ? body.connectorKey.trim()
      : `comm-${providerKey}-${crypto.randomUUID()}`;
    const region = typeof body.region === 'string' && body.region.trim() !== '' ? body.region.trim() : null;
    const priority = Number.isInteger(body.priority) && body.priority >= 0 ? body.priority : 100;
    const capabilityKeys: string[] = Array.isArray(body.capabilityKeys)
      ? body.capabilityKeys.filter((key: unknown): key is string => typeof key === 'string' && key.trim() !== '')
      : [];

    if (!CHANNELS.has(providerType)) {
      return NextResponse.json({ error: 'That communication channel is not supported.' }, { status: 400 });
    }
    const executable = executableCommunicationProvider(providerKey, providerType);
    if (executable === null) {
      return NextResponse.json(
        {
          error: 'That provider is cataloged for future integration but has no governed EXPADIO execution adapter yet.',
          reasonKey: 'PROVIDER_RUNTIME_NOT_IMPLEMENTED',
        },
        { status: 409 },
      );
    }
    if (capabilityKeys.length !== 1 || capabilityKeys[0] !== executable.capabilityKey) {
      return NextResponse.json(
        { error: `This provider may only be registered for ${executable.capabilityKey}.` },
        { status: 400 },
      );
    }
    if (!['PLATFORM_MANAGED', 'DELEGATED', 'CUSTOMER_REFERENCED', 'CUSTOMER_EGRESS'].includes(custodyMode)) {
      return NextResponse.json({ error: 'Unknown custody mode.' }, { status: 400 });
    }
    if (!['HOLD_AND_RETRY', 'FALLBACK_TRANSACTIONAL', 'REFUSE_IMMEDIATELY'].includes(failurePolicy)) {
      return NextResponse.json({ error: 'Unknown failure policy.' }, { status: 400 });
    }
    if (custodyMode !== 'CUSTOMER_EGRESS' && !isSecretReference(credentialRef)) {
      return NextResponse.json(
        {
          error: 'credentialRef must be an external secret reference (kms://, vault://, secret:// or provider-secret://). Use POST /custody/credentials to obtain one.',
        },
        { status: 400 },
      );
    }

    const created = await withTenantClient(context, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const connector = await client.query(
          `INSERT INTO platform.connectors
             (connector_key, provider_type, provider_key, ownership_scope, tenant_id,
              region, priority, enabled, fallback_enabled)
           VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, false, false)
           RETURNING connector_id, connector_key, provider_type, provider_key,
                     ownership_scope, region, priority, enabled, health, created_at`,
          [connectorKey, providerType, providerKey, ownershipScope, null, region, priority],
        );

        const connectorId = connector.rows[0].connector_id;
        const capability = await client.query(
          `SELECT capability_id FROM platform.capabilities
            WHERE capability_key = $1 AND enabled = true`,
          [executable.capabilityKey],
        );
        if (capability.rows.length === 0) {
          throw new Error(`Unknown or disabled capability: ${executable.capabilityKey}`);
        }
        await client.query(
          `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
           VALUES ($1, $2)`,
          [connectorId, capability.rows[0].capability_id],
        );

        if (custodyMode !== 'CUSTOMER_EGRESS') {
          await client.query(
            `INSERT INTO platform.connector_credentials
               (connector_id, credential_ref, key_version, custody_mode, fingerprint,
                state, probe_status, probe_checked_at, probe_warnings,
                detected_capabilities, failure_policy, hold_window_seconds,
                external_secret_arn, external_assume_role_arn, rotated_at)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'VALID', now(), $6::jsonb,
                     $7::text[], $8, $9, $10, $11, now())`,
            [
              connectorId,
              credentialRef,
              typeof body.keyVersion === 'string' ? body.keyVersion.trim() || null : null,
              custodyMode,
              fingerprint,
              JSON.stringify(Array.isArray(body.probeWarnings) ? body.probeWarnings : []),
              Array.isArray(body.detectedCapabilities) ? body.detectedCapabilities : [],
              failurePolicy,
              Number.isInteger(body.holdWindowSeconds) ? body.holdWindowSeconds : 900,
              custodyMode === 'CUSTOMER_REFERENCED' ? body.externalSecretArn ?? null : null,
              custodyMode === 'CUSTOMER_REFERENCED' ? body.externalAssumeRoleArn ?? null : null,
            ],
          );
        }

        await client.query('COMMIT');
        return connector.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return NextResponse.json({ success: true, connector: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown or disabled capability')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const { body, status } = deniedResponse(error);
    const denied = body as DeniedResult;
    return NextResponse.json(denied, { status });
  }
}
