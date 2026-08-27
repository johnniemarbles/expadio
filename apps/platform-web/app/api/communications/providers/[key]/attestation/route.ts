import { NextResponse } from 'next/server';
import {
  resolveRequestContext,
  withTenantClient,
  deniedResponse,
} from '../../../../../../lib/request-context';

/**
 * Design spec §2.6 — GET the signed revocation record.
 *
 * "The attestation is the deliverable, not the revocation." This is what a
 * customer's security team downloads and hands to their auditor.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext();
    const connectorKey = decodeURIComponent((await params).key);

    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT attestation_id, connector_key, revoked_at, revoked_by,
                last_lease_issued_at, last_lease_expired_at, leases_in_window,
                messages_rerouted, messages_cancelled, max_exposure_seconds,
                attestation_text, correlation_id, created_at
           FROM platform.credential_revocation_attestations
          WHERE tenant_id = $1::uuid AND connector_key = $2
          ORDER BY revoked_at DESC
          LIMIT 20`,
        [context.tenantId, connectorKey],
      );
      return result.rows;
    });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No revocation has been recorded for this connector.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ connectorKey, attestations: rows });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
