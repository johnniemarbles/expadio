import { requireCommunicationAdmin } from '../../../../../../lib/communication-admin';
import { NextResponse } from 'next/server';
import { nextCredentialHealth } from '@expadio/credential-custody';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../../lib/request-context';

/**
 * Design spec §2.7 — continuous credential health.
 *
 * A key that worked at setup fails later: rotated by the customer, permissions
 * narrowed, account suspended, card declined. Silence here is the worst outcome.
 *
 * FAILING fires BEFORE sends fail, and carries the provider's own error text —
 * not "provider error". A FAILING BYOK connector halves its bulk-plane
 * allocation immediately and leaves transactional untouched. Marketing
 * degrades first. Always.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);
    const connectorKey = decodeURIComponent((await params).key);

    const health = await withTenantTransaction(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const result = await client.query(
        `SELECT cred.state, cred.probe_status, cred.probe_checked_at, cred.probe_error,
                cred.probe_warnings, cred.custody_mode, cred.failure_policy,
                cred.hold_window_seconds, c.health AS connector_health, c.enabled
           FROM platform.connectors c
           JOIN platform.connector_credentials cred ON cred.connector_id = c.connector_id
          WHERE c.connector_key = $1
            AND (c.tenant_id = $2::uuid OR c.tenant_id IS NULL)
            AND cred.state <> 'SUPERSEDED'
          ORDER BY cred.created_at DESC
          LIMIT 1`,
        [connectorKey, context.tenantId],
      );
      return result.rows[0] ?? null;
    });

    if (health === null) {
      return NextResponse.json({ error: 'That connector was not found.' }, { status: 404 });
    }

    const probeStatus = (health.probe_status ?? 'VALID') as 'VALID' | 'FAILING' | 'INVALID';
    const transition = nextCredentialHealth({
      connectorKey,
      previous: probeStatus,
      consecutiveFailures: probeStatus === 'VALID' ? 0 : 1,
      probeValid: probeStatus === 'VALID',
      ...(health.probe_error !== null ? { probeError: health.probe_error } : {}),
    });

    return NextResponse.json({
      connectorKey,
      credentialState: health.state,
      probeStatus,
      probeCheckedAt: health.probe_checked_at?.toISOString?.() ?? null,
      // The provider's own words. Never invented, never generalised.
      probeError: health.probe_error,
      probeWarnings: health.probe_warnings ?? [],
      custodyMode: health.custody_mode,
      failurePolicy: health.failure_policy,
      holdWindowSeconds: health.hold_window_seconds,
      allocation: {
        transactionalMultiplier: transition.transactionalAllocationMultiplier,
        bulkMultiplier: transition.bulkAllocationMultiplier,
        note: 'Marketing degrades first. Transactional allocation is never reduced by a probe result.',
      },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
