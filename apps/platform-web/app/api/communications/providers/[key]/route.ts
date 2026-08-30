import { requireCommunicationAdmin } from '../../../../../lib/communication-admin';
import { NextResponse } from 'next/server';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
  ContextDenied,
} from '../../../../../lib/request-context';

/**
 * Design spec §0.2 G5 — un-scaffolding.
 *
 * PATCH and DELETE previously hardcoded the demo tenant and resolved context
 * with `auth()` directly, so a mutation always ran against tenant
 * 00000000-…-0001 regardless of the caller's workspace. They now resolve the
 * real tenant through `resolveRequestContext(request)` — which reads the
 * `?account/org` selection (proxy also injects it as headers) — exactly like
 * GET/POST on the collection route, so RLS applies and tenant isolation is
 * testable through the HTTP surface.
 *
 * DELETE here is the soft retirement (disable + mark DEGRADED). The provable,
 * attesting destruction of a credential lives at `[key]/revoke`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);
    const connectorKey = decodeURIComponent((await params).key);

    const body = await request.json();
    const { enabled, health } = body;
    if (typeof enabled !== 'boolean' || health !== undefined) {
      return NextResponse.json({ error: 'Supply enabled as a boolean. Health is measured by the platform, not set manually.' }, { status: 400 });
    }

    const connector = await withTenantTransaction(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const existing = await client.query(
        `SELECT connector_id, provider_key, provider_type FROM platform.connectors
          WHERE connector_key = $1 AND (tenant_id IS NULL OR tenant_id = $2::uuid)
          FOR UPDATE`, [connectorKey, context.tenantId],
      );
      if (existing.rows.length === 0) return null;
      if (enabled) {
        // Intake support alone is not delivery-adapter support. Expand this
        // gate only as production adapters gain their execution tests.
        if (existing.rows[0].provider_key !== 'resend' || existing.rows[0].provider_type !== 'email') {
          throw new ContextDenied('DELIVERY_ADAPTER_UNAVAILABLE', 'This provider does not yet have a supported platform delivery adapter.', 409);
        }
        const credentials = await client.query(
          `SELECT credential_id FROM platform.connector_credentials
            WHERE connector_id = $1::uuid AND state = 'ACTIVE' AND probe_status = 'VALID'
              AND credential_id = (SELECT current_credential.credential_id
                FROM platform.connector_credentials current_credential
                WHERE current_credential.connector_id = $1::uuid
                  AND current_credential.state <> 'SUPERSEDED'
                ORDER BY current_credential.created_at DESC, current_credential.credential_id DESC LIMIT 1)
              AND intake_receipt_id IS NOT NULL
              AND (expires_at IS NULL OR expires_at > now())
              AND detected_capabilities @> ARRAY['email.send']::text[]
              AND NOT (probe_warnings @> '[{"severity":"BLOCKING"}]'::jsonb)
            FOR UPDATE`, [existing.rows[0].connector_id],
        );
        if (credentials.rows.length !== 1) {
          throw new ContextDenied('VERIFIED_INTAKE_REQUIRED', 'Activation requires one active credential with server-recorded verification. Legacy credentials must be re-onboarded.', 409);
        }
      }
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = $1,
                updated_at = now()
          WHERE connector_key = $2
            AND (tenant_id IS NULL OR tenant_id = $3::uuid)
          RETURNING connector_key, provider_type, provider_key, health, enabled, updated_at`,
        [
          enabled,
          connectorKey,
          context.tenantId,
        ],
      );
      return result.rows[0] ?? null;
    });

    if (connector === null) {
      return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, connector });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);
    const connectorKey = decodeURIComponent((await params).key);

    const connector = await withTenantTransaction(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = false, health = 'DEGRADED', updated_at = now()
          WHERE connector_key = $1
            AND (tenant_id = $2::uuid OR (tenant_id IS NULL AND $3::boolean))
          RETURNING connector_key, enabled, health, updated_at`,
        [connectorKey, context.tenantId, context.platformScope],
      );
      return result.rows[0] ?? null;
    });

    if (connector === null) {
      return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, connector });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
