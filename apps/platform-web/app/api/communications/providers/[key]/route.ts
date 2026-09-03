import { NextResponse } from 'next/server';
import {
  resolveRequestContext,
  withTenantClient,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../../../lib/governance-authz';
import { executableCommunicationProvider } from '../../../../../lib/communication-runtime-providers';

/**
 * Platform provider mutation boundary. Existing catalog-only connectors may be
 * inspected/disabled/retired, but they cannot be enabled until EXPADIO has a
 * governed execution adapter for their provider/channel tuple.
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
    const requestedEnabled = enabledValue(body.enabled);
    const requestedHealth = typeof body.health === 'string' ? body.health : null;

    const outcome = await withTenantClient(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', false)");
      const existing = await client.query<{ provider_key: string; provider_type: string }>(
        `SELECT provider_key, provider_type
           FROM platform.connectors
          WHERE connector_key = $1
            AND tenant_id IS NULL
          LIMIT 1`,
        [connectorKey],
      );
      const metadata = existing.rows[0];
      if (metadata === undefined) return { kind: 'NOT_FOUND' as const };

      if (
        requestedEnabled === true
        && executableCommunicationProvider(metadata.provider_key, metadata.provider_type) === null
      ) {
        return {
          kind: 'UNSUPPORTED' as const,
          providerKey: metadata.provider_key,
          providerType: metadata.provider_type,
        };
      }

      const result = await client.query(
        `UPDATE platform.connectors
            SET enabled = COALESCE($1, enabled),
                health = COALESCE($2, health),
                updated_at = now()
          WHERE connector_key = $3
            AND tenant_id IS NULL
          RETURNING connector_key, provider_type, provider_key, health, enabled, updated_at`,
        [requestedEnabled, requestedHealth, connectorKey],
      );
      return { kind: 'OK' as const, connector: result.rows[0] };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Communication provider connector was not found.' }, { status: 404 });
    }
    if (outcome.kind === 'UNSUPPORTED') {
      return NextResponse.json(
        {
          error: `${outcome.providerKey}/${outcome.providerType} has no governed EXPADIO execution adapter and cannot be enabled.`,
          reasonKey: 'PROVIDER_RUNTIME_NOT_IMPLEMENTED',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, connector: outcome.connector });
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

function enabledValue(value: unknown): boolean | null {
  return value === undefined ? null : Boolean(value);
}
