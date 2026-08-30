import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface TemplateCatalogueItem {
  triggerKey: string;
  channels: string[];
  scope: string;
  activeCount: number;
  draftCount: number;
  totalVersions: number;
  contentFormats: string[];
  hasActiveVersion: boolean;
  locales: string[];
}

export async function GET() {
  try {
    const context = await resolveRequestContext();
    return await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT
           trigger_key,
           scope,
           COALESCE(ARRAY_AGG(DISTINCT channel ORDER BY channel), '{}') AS channels,
           COALESCE(ARRAY_AGG(DISTINCT content_format ORDER BY content_format), '{}') AS content_formats,
           COALESCE(ARRAY_AGG(DISTINCT locale ORDER BY locale), '{}') AS locales,
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_count,
           COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft_count,
           COUNT(*)::int AS total_versions
         FROM platform.communication_templates
         WHERE scope = 'PLATFORM' OR tenant_id = $1::uuid
         GROUP BY trigger_key, scope
         ORDER BY trigger_key, scope`,
        [context.tenantId]
      );

      if (result.rows.length === 0) return NextResponse.json([]);
      const items: TemplateCatalogueItem[] = result.rows.map((row: any) => ({
        triggerKey: row.trigger_key,
        channels: row.channels,
        scope: row.scope,
        activeCount: row.active_count,
        draftCount: row.draft_count,
        totalVersions: row.total_versions,
        contentFormats: row.content_formats,
        hasActiveVersion: row.active_count > 0,
        locales: row.locales,
      }));

      return NextResponse.json(items);
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Communications template catalogue API error:', err);
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: 'An internal error occurred.' }, { status: 500 });
  }
}

const PLATFORM_TEMPLATE_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext();

    const body = await request.json();
    const triggerKey = typeof body.triggerKey === 'string' ? body.triggerKey.trim() : '';
    const channel = typeof body.channel === 'string' ? body.channel.trim().toLowerCase() : '';
    const locale = typeof body.locale === 'string' && body.locale.trim() ? body.locale.trim() : 'en';
    const contentFormat = typeof body.contentFormat === 'string' ? body.contentFormat.trim().toUpperCase() : '';
    const templateBody = typeof body.body === 'string' ? body.body.trim() : '';
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
    const requiredVariables = Array.isArray(body.requiredVariables) ? body.requiredVariables : [];
    const defaultVariables = body.defaultVariables && typeof body.defaultVariables === 'object' && !Array.isArray(body.defaultVariables)
      ? body.defaultVariables
      : {};

    if (!triggerKey || !templateBody) {
      return NextResponse.json({ error: 'triggerKey and body are required.' }, { status: 400 });
    }
    if (!['email', 'sms', 'whatsapp', 'voice', 'in_app', 'push', 'rcs'].includes(channel)) {
      return NextResponse.json({ error: 'Unsupported template channel.' }, { status: 400 });
    }
    if (!['TEXT', 'HTML', 'MARKDOWN'].includes(contentFormat)) {
      return NextResponse.json({ error: 'Unsupported content format.' }, { status: 400 });
    }

    return await withTenantClient(context, async (client) => {
      await client.query('BEGIN');
      try {
        // Platform templates (tenant_id NULL, scope PLATFORM) may only be
        // authored by a subject holding a PLATFORM-scoped administration role.
        const role = await client.query(
          `SELECT 1
             FROM platform.authorization_assignments assignment
             JOIN platform.authorization_roles role ON role.role_id = assignment.role_id
            WHERE assignment.subject_id = $1
              AND assignment.status = 'ACTIVE'
              AND role.status = 'ACTIVE'
              AND role.ownership_scope = 'PLATFORM'
              AND role.role_key = ANY($2::text[])
              AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
            LIMIT 1`,
          [context.subjectId, PLATFORM_TEMPLATE_ROLES],
        );
        if (role.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Platform template administration is required.' }, { status: 403 });
        }

        await client.query(`SELECT set_config('app.platform_admin', 'true', true)`);
        const inserted = await client.query(
          `INSERT INTO platform.communication_templates
            (scope, tenant_id, organization_id, trigger_key, channel, locale, content_format, subject, title, body, required_variables, default_variables, status)
           VALUES ('PLATFORM', NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'DRAFT')
           RETURNING template_id, version, trigger_key, channel, locale, content_format, subject, title, status, created_at`,
          [triggerKey, channel, locale, contentFormat, subject, title, templateBody, JSON.stringify(requiredVariables), JSON.stringify(defaultVariables)],
        );
        await client.query('COMMIT');
        return NextResponse.json({ success: true, template: inserted.rows[0] }, { status: 201 });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Create platform communication template error:', err);
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: 'An internal error occurred.' }, { status: 500 });
  }
}
