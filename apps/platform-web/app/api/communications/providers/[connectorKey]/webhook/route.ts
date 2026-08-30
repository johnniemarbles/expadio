import { NextResponse } from 'next/server';
import {
  deniedResponse,
  requireStepUp,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import {
  hasGovernanceWriteRole,
  resolveGoverningRole,
} from '../../../../../../lib/governance-authz';
import { assertWebhookSecretReference } from '../../../../../../lib/webhook-signing-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicBase(request: Request): string {
  const configured = process.env.EXPADIO_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/u, '');
  return new URL(request.url).origin;
}

function callbackUrl(request: Request, tenantId: string, endpointKey: string): string {
  return `${publicBase(request)}/api/webhooks/communications/resend/${tenantId}/${endpointKey}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ connectorKey: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const connectorKey = decodeURIComponent((await params).connectorKey);

    const row = await withTenantTransaction(context, async (client) => {
      const result = await client.query<{
        provider_key: string;
        ownership_scope: string;
        endpoint_key: string | null;
        state: string | null;
        rotated_at: Date | string | null;
      }>(
        `SELECT c.provider_key, c.ownership_scope,
                binding.endpoint_key, binding.state, binding.rotated_at
           FROM platform.connectors c
           LEFT JOIN platform.communication_connector_webhook_bindings binding
             ON binding.tenant_id = c.tenant_id
            AND binding.connector_id = c.connector_id
          WHERE c.connector_key = $2
            AND c.tenant_id = $1::uuid
            AND c.ownership_scope = 'TENANT'
          LIMIT 1`,
        [context.tenantId, connectorKey],
      );
      return result.rows[0] ?? null;
    });

    if (row === null) {
      return NextResponse.json({ error: 'Tenant-owned connector was not found.' }, { status: 404 });
    }
    if (row.provider_key !== 'resend') {
      return NextResponse.json(
        { error: 'Webhook ingress is currently available for Resend connectors only.' },
        { status: 409 },
      );
    }

    return NextResponse.json({
      configured: row.endpoint_key !== null && row.state === 'ACTIVE',
      state: row.state,
      rotatedAt: row.rotated_at === null ? null : new Date(row.rotated_at).toISOString(),
      webhookUrl: row.endpoint_key === null
        ? null
        : callbackUrl(request, context.tenantId, row.endpoint_key),
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectorKey: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();
    const connectorKey = decodeURIComponent((await params).connectorKey);
    const body = await request.json().catch(() => null) as { signingSecretRef?: unknown } | null;
    const signingSecretRef =
      typeof body?.signingSecretRef === 'string' ? body.signingSecretRef.trim() : '';

    try {
      assertWebhookSecretReference({
        reference: signingSecretRef,
        tenantId: context.tenantId,
        connectorKey,
      });
    } catch {
      return NextResponse.json(
        { error: 'The webhook signing-secret reference is invalid for this tenant and connector.' },
        { status: 400 },
      );
    }

    const endpointKey = await withTenantTransaction(context, async (client) => {
      if (!await hasGovernanceWriteRole(client, context.subjectId)) {
        throw new Error('COMMUNICATION_WEBHOOK_CONFIG_FORBIDDEN');
      }
      const roleKey = await resolveGoverningRole(client, context.subjectId);
      if (roleKey === null) throw new Error('COMMUNICATION_WEBHOOK_CONFIG_FORBIDDEN');

      const connector = await client.query<{ connector_id: string }>(
        `SELECT connector_id
           FROM platform.connectors
          WHERE tenant_id = $1::uuid
            AND connector_key = $2
            AND ownership_scope = 'TENANT'
            AND provider_key = 'resend'
            AND provider_type = 'email'
          LIMIT 1`,
        [context.tenantId, connectorKey],
      );
      const connectorId = connector.rows[0]?.connector_id;
      if (connectorId === undefined) throw new Error('COMMUNICATION_WEBHOOK_CONNECTOR_UNSUPPORTED');

      const configured = await client.query<{ endpoint_key: string }>(
        `INSERT INTO platform.communication_connector_webhook_bindings (
           tenant_id, connector_id, provider_key, signing_secret_ref,
           state, configured_by_subject_id, rotated_at, revoked_at
         ) VALUES (
           $1::uuid, $2::uuid, 'resend', $3, 'ACTIVE', $4, clock_timestamp(), NULL
         )
         ON CONFLICT (tenant_id, connector_id)
         DO UPDATE SET
           signing_secret_ref = EXCLUDED.signing_secret_ref,
           state = 'ACTIVE',
           configured_by_subject_id = EXCLUDED.configured_by_subject_id,
           rotated_at = clock_timestamp(),
           revoked_at = NULL
         RETURNING endpoint_key`,
        [context.tenantId, connectorId, signingSecretRef, context.subjectId],
      );
      const value = configured.rows[0]?.endpoint_key;
      if (value === undefined) throw new Error('COMMUNICATION_WEBHOOK_CONFIG_WRITE_FAILED');
      return value;
    });

    return NextResponse.json({
      configured: true,
      webhookUrl: callbackUrl(request, context.tenantId, endpointKey),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'COMMUNICATION_WEBHOOK_CONFIG_FORBIDDEN') {
      return NextResponse.json(
        { error: 'A tenant governance administrator role is required.' },
        { status: 403 },
      );
    }
    if (error instanceof Error && error.message === 'COMMUNICATION_WEBHOOK_CONNECTOR_UNSUPPORTED') {
      return NextResponse.json(
        { error: 'Webhook ingress requires a tenant-owned Resend email connector.' },
        { status: 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
