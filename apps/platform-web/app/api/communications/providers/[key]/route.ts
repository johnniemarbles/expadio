import { NextResponse } from 'next/server';
import {
  resolveRequestContext,
  withTenantClient,
  deniedResponse,
} from '../../../../../lib/request-context';

/**
 * Design spec §0.2 G5 — remove hardcoded tenant context.
 *
 * PATCH and DELETE previously hardcoded bootstrap tenant context and resolved
 * context with `auth()` directly, so a mutation could run against the wrong
 * workspace regardless of the caller's selected account. They now resolve the
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

    const body = await request.json();
    const { enabled, health } = body;

    const connector = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = COALESCE($1, enabled),
                health = COALESCE($2, health),
                updated_at = now()
          WHERE connector_key = $3
            AND (tenant_id IS NULL OR tenant_id = $4::uuid)
          RETURNING connector_key, provider_type, provider_key, health, enabled, updated_at`,
        [
          enabled !== undefined ? Boolean(enabled) : null,
          typeof health === 'string' ? health : null,
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
    const connectorKey = decodeURIComponent((await params).key);

    const connector = await withTenantClient(context, async (client) => {
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
