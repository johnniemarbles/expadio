import { NextResponse } from 'next/server';
import {
  resolveRequestContext,
  withTenantClient,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../../../lib/governance-authz';

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
    const connectorKey = decodeURIComponent((await params).key);
    const platformAuthorized = await withTenantTransaction(
      context,
      (client) => hasPlatformAdministrationRole(client, context.subjectId),
    );
    if (!platformAuthorized) {
      return NextResponse.json(
        { denied: true, reasonKey: 'PLATFORM_ADMIN_REQUIRED', message: 'Only Platform Administration can manage providers.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { enabled, health } = body;

    const connector = await withTenantClient(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', false)");
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = COALESCE($1, enabled),
                health = COALESCE($2, health),
                updated_at = now()
          WHERE connector_key = $3
            AND tenant_id IS NULL
          RETURNING connector_key, provider_type, provider_key, health, enabled, updated_at`,
        [
          enabled !== undefined ? Boolean(enabled) : null,
          typeof health === 'string' ? health : null,
          connectorKey,
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
    const connectorKey = decodeURIComponent((await params).key);
    const platformAuthorized = await withTenantTransaction(
      context,
      (client) => hasPlatformAdministrationRole(client, context.subjectId),
    );
    if (!platformAuthorized) {
      return NextResponse.json(
        { denied: true, reasonKey: 'PLATFORM_ADMIN_REQUIRED', message: 'Only Platform Administration can manage providers.' },
        { status: 403 },
      );
    }

    const connector = await withTenantClient(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', false)");
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = false, health = 'DEGRADED', updated_at = now()
          WHERE connector_key = $1
            AND tenant_id IS NULL
          RETURNING connector_key, enabled, health, updated_at`,
        [connectorKey],
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
