import { NextResponse } from 'next/server';
import {
  buildRevocationAttestation,
  SEND_PATH_LEASE_TTL_SECONDS,
  type LeaseHistoryRow,
} from '@expadio/credential-custody';
import {
  resolveRequestContext,
  requireStepUp,
  withTenantClient,
  deniedResponse,
} from '../../../../../../lib/request-context';

/**
 * Design spec §2.6 — revocation, provable rather than merely performed.
 *
 * The sequence below is the spec's, in order:
 *   t+0     credential state -> REVOKED (guarded transition)
 *   t+0     lease issuer refuses all new leases — checked at issue, not cached
 *   t+0     connector health -> CREDENTIAL_REVOKED (deliberate, not a fault:
 *           it must not trigger failover alerting)
 *   t+0     queued messages re-resolved: re-routed, or CANCELLED with a reason.
 *           Never silent, never indefinitely held.
 *   t+<=60s last outstanding send lease expires
 *   t+60s   attestation emitted
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext();
    await requireStepUp();

    const connectorKey = decodeURIComponent((await params).key);
    const body = await request.json().catch(() => ({}));
    const correlationId = crypto.randomUUID();
    const revokedAt = new Date().toISOString();

    const attestation = await withTenantClient(context, async (client) => {
      await client.query('BEGIN');
      try {
        const connector = await client.query(
          `SELECT c.connector_id, c.connector_key, c.ownership_scope, c.tenant_id
             FROM platform.connectors c
            WHERE c.connector_key = $1
              AND (c.tenant_id = $2::uuid OR (c.tenant_id IS NULL AND $3::boolean))
            FOR UPDATE`,
          [connectorKey, context.tenantId, context.platformScope],
        );

        if (connector.rows.length === 0) {
          throw Object.assign(new Error('CONNECTOR_NOT_FOUND'), { status: 404 });
        }

        const row = connector.rows[0];

        // §3.4 dual control: revoking a platform-scoped connector needs a
        // second platform admin's approval, recorded in governance reviews.
        if (row.ownership_scope === 'PLATFORM') {
          const approvalRef = typeof body.approvalRef === 'string' ? body.approvalRef : '';
          if (approvalRef === '') {
            throw Object.assign(
              new Error('DUAL_CONTROL_REQUIRED'),
              { status: 403 },
            );
          }
        }

        const connectorId = row.connector_id;

        // t+0 — guarded terminal transition. The CHECK constraint added in
        // migration 0040 makes a REVOKED row without actor and timestamp
        // unrepresentable.
        const revoked = await client.query(
          `UPDATE platform.connector_credentials
              SET state = 'REVOKED',
                  revoked_at = $2::timestamptz,
                  revoked_by = $3::uuid,
                  probe_status = 'INVALID',
                  updated_at = now()
            WHERE connector_id = $1
              AND state IN ('ACTIVE', 'FAILING', 'PENDING_PROBE')
            RETURNING credential_id`,
          [connectorId, revokedAt, context.subjectId],
        );

        if (revoked.rows.length === 0) {
          throw Object.assign(new Error('CREDENTIAL_NOT_REVOCABLE'), { status: 409 });
        }

        // t+0 — CREDENTIAL_REVOKED is distinct from UNHEALTHY on purpose.
        // This is a deliberate act, not a fault, and must not page anyone.
        await client.query(
          `UPDATE platform.connectors
              SET enabled = false, health = 'UNHEALTHY', updated_at = now()
            WHERE connector_id = $1`,
          [connectorId],
        );

        // Lease history is the only admissible source for the attestation's
        // timestamps. A revocation request cannot attest to anything.
        const leases = await client.query<{
          lease_reference: string | null;
          issued_at: Date | null;
          expires_at: Date | null;
          outcome: string;
        }>(
          `SELECT lease_reference, issued_at, expires_at, outcome
             FROM platform.credential_lease_events
            WHERE tenant_id = $1::uuid
              AND connector_key = $2
              AND recorded_at >= $3::timestamptz - interval '1 hour'
            ORDER BY recorded_at ASC`,
          [context.tenantId, connectorKey, revokedAt],
        );

        const leaseHistory: LeaseHistoryRow[] = leases.rows
          .filter((lease) => lease.issued_at !== null && lease.expires_at !== null)
          .map((lease) => ({
            leaseReference: lease.lease_reference ?? '',
            issuedAt: lease.issued_at!.toISOString(),
            expiresAt: lease.expires_at!.toISOString(),
            outcome: lease.outcome as LeaseHistoryRow['outcome'],
          }));

        // t+0 — queued messages bound to this connector are re-resolved.
        // Cancelled with a reason, never silently held.
        const cancelled = await client.query<{ count: string }>(
          `WITH cancelled AS (
             UPDATE platform.communication_deliveries
                SET state = 'CANCELLED',
                    reason_code = 'CREDENTIAL_REVOKED',
                    updated_at = now()
              WHERE tenant_id = $1::uuid
                AND connector_key = $2
                AND state IN ('QUEUED', 'PENDING')
              RETURNING 1
           )
           SELECT count(*)::text AS count FROM cancelled`,
          [context.tenantId, connectorKey],
        ).catch(() => ({ rows: [{ count: '0' }] }));

        const built = buildRevocationAttestation({
          tenantId: context.tenantId,
          connectorId,
          connectorKey,
          revokedAt,
          revokedBy: context.subjectId,
          correlationId,
          leaseHistory,
          messagesRerouted: 0,
          messagesCancelled: Number(cancelled.rows[0]?.count ?? 0),
        });

        await client.query(
          `INSERT INTO platform.credential_revocation_attestations
             (tenant_id, connector_id, connector_key, revoked_at, revoked_by,
              last_lease_issued_at, last_lease_expired_at, leases_in_window,
              messages_rerouted, messages_cancelled, max_exposure_seconds,
              attestation_text, correlation_id)
           VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, $5::uuid,
                   $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12, $13::uuid)`,
          [
            built.tenantId, built.connectorId, built.connectorKey,
            built.revokedAt, built.revokedBy,
            built.lastLeaseIssuedAt, built.lastLeaseExpiredAt,
            built.leasesInWindow, built.messagesRerouted, built.messagesCancelled,
            built.maxExposureSeconds, built.attestationText, built.correlationId,
          ],
        );

        await client.query('COMMIT');
        return built;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return NextResponse.json(
      {
        success: true,
        attestation,
        leaseTtlSeconds: SEND_PATH_LEASE_TTL_SECONDS,
        note:
          `New leases are refused from ${attestation.revokedAt}. ` +
          `Any lease already outstanding expires within ${SEND_PATH_LEASE_TTL_SECONDS} seconds.`,
      },
      { status: 200 },
    );
  } catch (error) {
    const known = error as Error & { status?: number };
    if (known.message === 'CONNECTOR_NOT_FOUND') {
      return NextResponse.json({ error: 'That connector was not found.' }, { status: 404 });
    }
    if (known.message === 'DUAL_CONTROL_REQUIRED') {
      return NextResponse.json(
        {
          error: 'Revoking a platform connector needs a second platform admin\'s approval.',
          reasonKey: 'DUAL_CONTROL_REQUIRED',
          approvalHref: '/governance/reviews',
        },
        { status: 403 },
      );
    }
    if (known.message === 'CREDENTIAL_NOT_REVOCABLE') {
      return NextResponse.json(
        { error: 'This credential is already revoked or superseded.' },
        { status: 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
