import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../../../lib/iam-adapter';

const PLATFORM_TEMPLATE_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' },
    );
    const triggerKey = decodeURIComponent((await params).key);
    const body = await request.json();
    const templateId = typeof body.templateId === 'string' ? body.templateId : '';
    const version = Number.isInteger(body.version) && body.version > 0 ? body.version : 0;
    if (!templateId || !version) return NextResponse.json({ error: 'templateId and positive version are required.' }, { status: 400 });

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query(
        `SELECT 1 FROM platform.authorization_assignments a
          JOIN platform.authorization_roles r ON r.role_id = a.role_id
          WHERE a.subject_id = $1 AND a.status = 'ACTIVE' AND r.status = 'ACTIVE'
            AND r.ownership_scope = 'PLATFORM' AND r.role_key = ANY($2::text[])
            AND (a.valid_until IS NULL OR a.valid_until > now()) LIMIT 1`,
        [userId, PLATFORM_TEMPLATE_ROLES],
      );
      if (role.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN' }, { status: 403 });
      }

      await client.query(`SELECT set_config('app.platform_admin', 'true', true)`);
      const target = await client.query(
        `SELECT template_id, version, trigger_key, channel, locale, status
           FROM platform.communication_templates
          WHERE template_id = $1::uuid AND version = $2 AND trigger_key = $3
            AND scope = 'PLATFORM' FOR UPDATE`,
        [templateId, version, triggerKey],
      );
      if (target.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Template version not found.' }, { status: 404 });
      }
      if (target.rows[0].status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Only DRAFT template versions can be published.' }, { status: 409 });
      }

      await client.query(
        `UPDATE platform.communication_templates SET status = 'ARCHIVED', updated_at = now()
          WHERE scope = 'PLATFORM' AND trigger_key = $1 AND channel = $2
            AND lower(locale) = lower($3) AND status = 'ACTIVE'`,
        [target.rows[0].trigger_key, target.rows[0].channel, target.rows[0].locale],
      );
      const published = await client.query(
        `UPDATE platform.communication_templates SET status = 'ACTIVE', updated_at = now()
          WHERE template_id = $1::uuid AND version = $2
          RETURNING template_id, version, trigger_key, channel, locale, status, updated_at`,
        [templateId, version],
      );
      await client.query('COMMIT');
      return NextResponse.json({ success: true, template: published.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Publish platform communication template error:', err);
    return NextResponse.json({ error: err.message || 'Template publication failed.' }, { status: 500 });
  }
}
