import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../../../lib/iam-adapter';

const BRAND_TEMPLATE_ROLES = ['TENANT_OWNER', 'TENANT_ADMIN'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const context = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' },
    );
    const triggerKey = decodeURIComponent((await params).key);
    const body = await request.json();
    const channel = typeof body.channel === 'string' ? body.channel.trim().toLowerCase() : '';
    const locale = typeof body.locale === 'string' && body.locale.trim() ? body.locale.trim() : 'en';
    if (!channel) return NextResponse.json({ error: 'channel is required.' }, { status: 400 });

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [context.tenantId]);
      const role = await client.query(
        `SELECT 1 FROM platform.authorization_assignments a
          JOIN platform.authorization_roles r ON r.role_id = a.role_id
          WHERE a.tenant_id = $1::uuid AND a.subject_id = $2
            AND a.status = 'ACTIVE' AND r.status = 'ACTIVE'
            AND r.role_key = ANY($3::text[])
            AND (a.valid_until IS NULL OR a.valid_until > now()) LIMIT 1`,
        [context.tenantId, userId, BRAND_TEMPLATE_ROLES],
      );
      if (role.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN' }, { status: 403 });
      }

      const source = await client.query(
        `SELECT template_id, version, trigger_key, channel, locale, content_format,
                subject, title, body, required_variables, default_variables
           FROM platform.communication_templates
          WHERE scope = 'PLATFORM' AND trigger_key = $1 AND channel = $2
            AND lower(locale) = lower($3) AND status = 'ACTIVE'
          ORDER BY version DESC LIMIT 1`,
        [triggerKey, channel, locale],
      );
      if (source.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Active platform template not found.' }, { status: 404 });
      }
      const sourceRow = source.rows[0];

      // Serialize clones for the same tenant/template key so two concurrent requests
      // cannot both pass the duplicate check and create duplicate drafts.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${context.tenantId}:${triggerKey}:${channel}:${locale.toLowerCase()}`],
      );

      const existing = await client.query(
        `SELECT 1 FROM platform.communication_templates
          WHERE scope = 'TENANT' AND tenant_id = $1::uuid AND trigger_key = $2
            AND channel = $3 AND lower(locale) = lower($4) AND status <> 'ARCHIVED' LIMIT 1`,
        [context.tenantId, triggerKey, channel, locale],
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'A brand template already exists for this trigger, channel and locale.' }, { status: 409 });
      }

      const cloned = await client.query(
        `INSERT INTO platform.communication_templates
          (scope, tenant_id, organization_id, trigger_key, channel, locale, content_format,
           subject, title, body, required_variables, default_variables, status,
           cloned_source_template_id, cloned_source_version, platform_update_available)
         VALUES ('TENANT', $1::uuid, NULL, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
                 'DRAFT', $11::uuid, $12, false)
         RETURNING template_id, version, trigger_key, channel, locale, status,
                   cloned_source_template_id, cloned_source_version, platform_update_available`,
        [context.tenantId, sourceRow.trigger_key, sourceRow.channel, sourceRow.locale,
         sourceRow.content_format, sourceRow.subject, sourceRow.title, sourceRow.body,
         JSON.stringify(sourceRow.required_variables), JSON.stringify(sourceRow.default_variables),
         sourceRow.template_id, sourceRow.version],
      );
      await client.query('COMMIT');
      return NextResponse.json({ success: true, template: cloned.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Clone platform communication template error:', err);
    return NextResponse.json({ error: err.message || 'Template clone failed.' }, { status: 500 });
  }
}
