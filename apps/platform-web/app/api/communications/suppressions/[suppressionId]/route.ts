import { NextResponse } from 'next/server';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../../lib/request-context';

const ADMIN_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'];

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ suppressionId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const suppressionId = decodeURIComponent((await params).suppressionId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppressionId)) {
      return NextResponse.json({ error: 'Invalid suppression identifier.' }, { status: 400 });
    }

    return await withTenantClient(context, async (client) => {
      const role = await client.query(
        `SELECT 1
           FROM platform.authorization_assignments assignment
           JOIN platform.authorization_roles role ON role.role_id = assignment.role_id
          WHERE assignment.subject_id = $1
            AND assignment.status = 'ACTIVE'
            AND role.status = 'ACTIVE'
            AND role.role_key = ANY($2::text[])
            AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
            AND (
              role.ownership_scope = 'PLATFORM'
              OR (role.ownership_scope = 'TENANT' AND role.tenant_id = $3::uuid)
            )
          LIMIT 1`,
        [context.subjectId, ADMIN_ROLES, context.tenantId],
      );
      if (role.rows.length === 0) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Suppression administration is required.' }, { status: 403 });
      }

      const repository = new PostgresCommunicationSuppressionRepository(client);
      const revoked = await repository.revoke({ tenantId: context.tenantId, suppressionId });
      if (!revoked) {
        return NextResponse.json({ error: 'Active suppression was not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, suppressionId, status: 'REVOKED' });
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
