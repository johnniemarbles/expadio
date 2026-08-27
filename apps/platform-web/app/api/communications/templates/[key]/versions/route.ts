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
    const sourceTemplateId = typeof body.templateId === 'string' ? body.templateId : '';
    if (!sourceTemplateId) return NextResponse.json({ error: 'templateId is required.' }, { status: 400 });

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

      const source = await client.query(
        `SELECT * FROM platform.communication_templates
          WHERE template_id = $1::uuid AND trigger_key = $2 AND scope = 'PLATFORM'
          ORDER BY version DESC FOR UPDATE`,
        [sourceTemplateId, triggerKey],
      );
      if (source.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
      }
      if (source.rows.some((row: any) => row.status === 'DRAFT')) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'A draft version already exists.' }, { status: 409 });
      }

      const latest = source.rows[0];
      const templateBody = typeof body.body === 'string' && body.body.trim() ? body.body.trim() : latest.body;
      const requiredVariables = Array.isArray(body.requiredVariables) ? body.requiredVariables : latest.required_variables;
      const defaultVariables = body.defaultVariables && typeof body.defaultVariables === 'object' && !Array.isArray(body.defaultVariables)
        ? body.defaultVariables : latest.default_variables;
      const subject = body.subject === null || typeof body.subject === 'string' ? body.subject : latest.subject;
      const title = body.title === null || typeof body.title === 'string' ? body.title : latest.title;
      const nextVersion = Number(latest.version) + 1;

      const inserted = await client.query(
        `INSERT INTO platform.communication_templates
          (template_id, version, scope, tenant_id, organization_id, trigger_key, channel, locale, content_format,
           subject, title, body, required_variables, default_variables, status)
         VALUES ($1::uuid, $2, 'PLATFORM', NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, 'DRAFT')
         RETURNING template_id, version, trigger_key, channel, locale, content_format, subject, title, status, created_at`,
        [sourceTemplateId, nextVersion, latest.trigger_key, latest.channel, latest.locale, latest.content_format,
         subject, title, templateBody, JSON.stringify(requiredVariables), JSON.stringify(defaultVariables)],
      );
      await client.query('COMMIT');
      return NextResponse.json({ success: true, template: inserted.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Create communication template version error:', err);
    return NextResponse.json({ error: err.message || 'Template version creation failed.' }, { status: 500 });
  }
}
