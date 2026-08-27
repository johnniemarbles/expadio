import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export interface ConnectorListItem {
  connectorKey: string;
  providerType: string;
  providerKey: string;
  ownershipScope: string;
  health: string;
  enabled: boolean;
  capabilityKeys: string[];
  hasCredential: boolean;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
      `SELECT
         c.connector_key,
         c.provider_type,
         c.provider_key,
         c.ownership_scope,
         c.health,
         c.enabled,
         COALESCE(ARRAY_AGG(DISTINCT cap.capability_key) FILTER (WHERE cap.capability_key IS NOT NULL), '{}') AS capability_keys,
         EXISTS(
           SELECT 1 FROM platform.connector_credentials cred
           WHERE cred.connector_id = c.connector_id
         ) AS has_credential
       FROM platform.connectors c
       LEFT JOIN platform.connector_capabilities cc ON cc.connector_id = c.connector_id
       LEFT JOIN platform.capabilities cap ON cap.capability_id = cc.capability_id
       WHERE (c.tenant_id IS NULL OR c.tenant_id = $1::uuid)
         AND (
           c.provider_type IN ('email', 'sms', 'whatsapp', 'voice', 'push', 'rcs', 'messaging')
           OR cap.capability_key ILIKE '%email%'
           OR cap.capability_key ILIKE '%sms%'
           OR cap.capability_key ILIKE '%whatsapp%'
           OR cap.capability_key ILIKE '%voice%'
           OR cap.capability_key ILIKE '%delivery%'
           OR cap.capability_key ILIKE '%comm%'
         )
       GROUP BY c.connector_id
       ORDER BY c.priority, c.connector_key`,
      [effectiveContext.tenantId]
    );

    const connectors: ConnectorListItem[] = result.rows.map((row: any) => ({
      connectorKey: row.connector_key,
      providerType: row.provider_type,
      providerKey: row.provider_key,
      ownershipScope: row.ownership_scope,
      health: row.health,
      enabled: row.enabled,
      capabilityKeys: row.capability_keys,
      hasCredential: row.has_credential,
    }));

    return NextResponse.json(connectors);
  } catch (err: any) {
    console.error('Communications providers API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message };
    return NextResponse.json(denied, { status: 500 });
  }
}


const SUPPORTED_PROVIDER_KEYS = new Set([
  'ses', 'sendgrid', 'resend', 'postmark', 'mailgun', 'smtp',
  'twilio-sms', 'twilio-whatsapp', 'twilio-voice', 'vonage-sms',
  'vonage-voice', 'messagebird-sms', 'messagebird-whatsapp', '360dialog',
  'firebase', 'apns', 'web-push',
]);

function isSecretReference(value: unknown): value is string {
  return typeof value === 'string' && /^(kms|vault|secret|provider-secret):\\/\\/[^\\s]+$/.test(value);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' }, { status: 401 });

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );
    const body = await request.json();
    const providerKey = typeof body.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';
    const providerType = typeof body.providerType === 'string' ? body.providerType.trim().toLowerCase() : '';
    const connectorKey = typeof body.connectorKey === 'string' && body.connectorKey.trim()
      ? body.connectorKey.trim()
      : `comm-${providerKey}-${crypto.randomUUID()}`;
    const region = typeof body.region === 'string' && body.region.trim() ? body.region.trim() : null;
    const priority = Number.isInteger(body.priority) && body.priority >= 0 ? body.priority : 100;
    const capabilityKeys = Array.isArray(body.capabilityKeys)
      ? body.capabilityKeys.filter((key: unknown): key is string => typeof key === 'string' && key.trim()).map((key: string) => key.trim())
      : [];
    const credentialRef = body.credentialRef;

    if (!SUPPORTED_PROVIDER_KEYS.has(providerKey)) {
      return NextResponse.json({ error: 'Unsupported communication provider.' }, { status: 400 });
    }
    if (!['email', 'sms', 'whatsapp', 'voice', 'push', 'rcs'].includes(providerType)) {
      return NextResponse.json({ error: 'Unsupported communication channel.' }, { status: 400 });
    }
    if (!isSecretReference(credentialRef)) {
      return NextResponse.json({ error: 'credentialRef must be an external secret reference (kms://, vault://, secret:// or provider-secret://).' }, { status: 400 });
    }
    if (capabilityKeys.length === 0) {
      return NextResponse.json({ error: 'At least one capability is required.' }, { status: 400 });
    }

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const connector = await client.query(
        `INSERT INTO platform.connectors
          (connector_key, provider_type, provider_key, ownership_scope, tenant_id, region, priority, enabled, fallback_enabled)
         VALUES ($1, $2, $3, 'PLATFORM', NULL, $4, $5, false, false)
         RETURNING connector_id, connector_key, provider_type, provider_key, ownership_scope, region, priority, enabled, fallback_enabled, health, created_at`,
        [connectorKey, providerType, providerKey, region, priority],
      );
      const connectorId = connector.rows[0].connector_id;
      for (const capabilityKey of capabilityKeys) {
        const capability = await client.query(
          `SELECT capability_id FROM platform.capabilities WHERE capability_key = $1 AND enabled = true`,
          [capabilityKey],
        );
        if (capability.rows.length === 0) throw new Error(`Unknown or disabled capability: ${capabilityKey}`);
        await client.query(
          `INSERT INTO platform.connector_capabilities (connector_id, capability_id) VALUES ($1, $2)`,
          [connectorId, capability.rows[0].capability_id],
        );
      }
      await client.query(
        `INSERT INTO platform.connector_credentials (connector_id, credential_ref, key_version, rotated_at)
         VALUES ($1, $2, $3, now())`,
        [connectorId, credentialRef, typeof body.keyVersion === 'string' ? body.keyVersion.trim() || null : null],
      );
      await client.query('COMMIT');
      return NextResponse.json({ success: true, connector: connector.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Communication provider registration error:', err);
    return NextResponse.json({ error: err.message || 'Provider registration failed.' }, { status: 500 });
  }
}
