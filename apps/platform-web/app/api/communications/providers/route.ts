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
