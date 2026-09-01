import { NextRequest } from 'next/server';
import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { dbPool } from '../../../../lib/iam-adapter';
import {
  grantTenantMembership,
  TENANT_ACCESS_ROLE_KEYS,
  type TenantAccessRoleKey,
} from '../../../../lib/tenant-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const event = await verifyWebhook(request);
    if (event.type !== 'user.created') return new Response('ignored', { status: 200 });

    const metadata = event.data.public_metadata as Record<string, unknown> | undefined;
    const access = metadata?.expadioAccess as Record<string, unknown> | undefined;
    const tenantId = typeof access?.tenantId === 'string' ? access.tenantId : '';
    const organizationId = typeof access?.organizationId === 'string' ? access.organizationId : '';
    const roleKey = typeof access?.roleKey === 'string' ? access.roleKey.toUpperCase() : '';
    const invitedBy = typeof access?.invitedBySubjectId === 'string' ? access.invitedBySubjectId : 'clerk-webhook';
    const issuer = typeof access?.issuer === 'string' ? access.issuer : 'https://clerk.expadio.com';
    const validUntilRaw = typeof access?.validUntil === 'string' ? access.validUntil : null;
    const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;

    if (
      !UUID.test(tenantId)
      || !UUID.test(organizationId)
      || !TENANT_ACCESS_ROLE_KEYS.includes(roleKey as TenantAccessRoleKey)
      || (validUntil !== null && !Number.isFinite(validUntil.getTime()))
    ) {
      return new Response('No valid EXPADIO access grant on this user.', { status: 200 });
    }

    const correlationId = request.headers.get('svix-id') || event.data.id;
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const replay = await client.query(
        `SELECT 1 FROM platform.domain_events
          WHERE tenant_id = $1::uuid
            AND event_type = 'tenant.membership.granted'
            AND correlation_id = $2
          LIMIT 1`,
        [tenantId, correlationId],
      );
      if (!replay.rows[0]) {
        await grantTenantMembership(client, {
          tenantId,
          organizationId,
          subjectId: event.data.id,
          issuer,
          roleKey: roleKey as TenantAccessRoleKey,
          validUntil,
          actorSubjectId: invitedBy,
          correlationId,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return new Response('EXPADIO membership provisioned.', { status: 200 });
  } catch (error) {
    console.error('Clerk access webhook failed:', error);
    return new Response('Webhook verification or provisioning failed.', { status: 400 });
  }
}
