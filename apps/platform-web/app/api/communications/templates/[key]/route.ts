import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface TemplateDetailRecord {
  templateId: string;
  triggerKey: string;
  channel: string;
  version: number;
  scope: string;
  locale: string;
  contentFormat: 'TEXT' | 'HTML' | 'MARKDOWN';
  subject: string | null;
  title: string | null;
  body: string;
  requiredVariables: string[];
  defaultVariables: Record<string, any>;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  updatedAt: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const context = await resolveRequestContext();
    const triggerKey = decodeURIComponent((await params).key);

    return await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT
           template_id,
           trigger_key,
           channel,
           version,
           scope,
           locale,
           content_format,
           subject,
           title,
           body,
           required_variables,
           default_variables,
           status,
           updated_at
         FROM platform.communication_templates
         WHERE trigger_key = $1
           AND (scope = 'PLATFORM' OR tenant_id = $2::uuid)
         ORDER BY version DESC`,
        [triggerKey, context.tenantId]
      );

      if (result.rows.length === 0) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
      const row = result.rows[0];
      const template: TemplateDetailRecord = {
        templateId: row.template_id,
        triggerKey: row.trigger_key,
        channel: row.channel,
        version: row.version,
        scope: row.scope,
        locale: row.locale,
        contentFormat: row.content_format,
        subject: row.subject,
        title: row.title,
        body: row.body,
        requiredVariables: Array.isArray(row.required_variables) ? row.required_variables : [],
        defaultVariables: typeof row.default_variables === 'object' ? row.default_variables : {},
        status: row.status,
        updatedAt: new Date(row.updated_at).toISOString(),
      };

      return NextResponse.json(template);
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Template detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const PLATFORM_TEMPLATE_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];
const TENANT_TEMPLATE_ROLES = ['TENANT_OWNER', 'TENANT_ADMIN'];

/**
 * Edit a DRAFT template's content (design §6 — the missing edit step between
 * "create draft" and "publish"). Only DRAFT rows are editable; ACTIVE/ARCHIVED
 * versions are immutable — publish a new draft to change them. Authoring is
 * gated by the row's scope: platform templates need a PLATFORM admin role,
 * brand (tenant) drafts need a tenant owner/admin.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const triggerKey = decodeURIComponent((await params).key);
    const body = await request.json();

    const templateId = typeof body.templateId === 'string' ? body.templateId : '';
    const version = Number.isInteger(body.version) && body.version > 0 ? body.version : 0;
    if (!templateId || !version) {
      return NextResponse.json({ error: 'templateId and a positive version are required.' }, { status: 400 });
    }

    const contentFormat = typeof body.contentFormat === 'string' ? body.contentFormat.trim().toUpperCase() : '';
    const templateBody = typeof body.body === 'string' ? body.body.trim() : '';
    const subject = body.subject === null || typeof body.subject === 'string' ? (body.subject ? String(body.subject).trim() : null) : null;
    const title = body.title === null || typeof body.title === 'string' ? (body.title ? String(body.title).trim() : null) : null;
    const requiredVariables = Array.isArray(body.requiredVariables) ? body.requiredVariables.filter((v: unknown) => typeof v === 'string') : [];
    const defaultVariables = body.defaultVariables && typeof body.defaultVariables === 'object' && !Array.isArray(body.defaultVariables) ? body.defaultVariables : {};

    if (!templateBody) return NextResponse.json({ error: 'The template body is required.' }, { status: 400 });
    if (!['TEXT', 'HTML', 'MARKDOWN'].includes(contentFormat)) {
      return NextResponse.json({ error: 'Unsupported content format.' }, { status: 400 });
    }

    return await withTenantClient(context, async (client) => {
      await client.query('BEGIN');
      try {
        const target = await client.query(
          `SELECT scope, status FROM platform.communication_templates
            WHERE template_id = $1::uuid AND version = $2 AND trigger_key = $3
              AND (scope = 'PLATFORM' OR tenant_id = $4::uuid)
            FOR UPDATE`,
          [templateId, version, triggerKey, context.tenantId],
        );
        if (target.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Template version not found.' }, { status: 404 });
        }
        if (target.rows[0].status !== 'DRAFT') {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Only DRAFT template versions can be edited. Publish a new draft to change an active template.' }, { status: 409 });
        }

        const scope = target.rows[0].scope;
        const roles = scope === 'PLATFORM' ? PLATFORM_TEMPLATE_ROLES : TENANT_TEMPLATE_ROLES;
        const role = await client.query(
          `SELECT 1 FROM platform.authorization_assignments a
             JOIN platform.authorization_roles r ON r.role_id = a.role_id
            WHERE a.subject_id = $1 AND a.status = 'ACTIVE' AND r.status = 'ACTIVE'
              AND r.role_key = ANY($2::text[])
              AND (a.valid_until IS NULL OR a.valid_until > now()) LIMIT 1`,
          [context.subjectId, roles],
        );
        if (role.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You do not have permission to edit this template.' }, { status: 403 });
        }

        if (scope === 'PLATFORM') {
          await client.query(`SELECT set_config('app.platform_admin', 'true', true)`);
        }

        const updated = await client.query(
          `UPDATE platform.communication_templates
              SET subject = $1, title = $2, body = $3, content_format = $4,
                  required_variables = $5::jsonb, default_variables = $6::jsonb, updated_at = now()
            WHERE template_id = $7::uuid AND version = $8
            RETURNING template_id, version, trigger_key, channel, locale, content_format, subject, title, status, updated_at`,
          [subject, title, templateBody, contentFormat, JSON.stringify(requiredVariables), JSON.stringify(defaultVariables), templateId, version],
        );
        await client.query('COMMIT');
        return NextResponse.json({ success: true, template: updated.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }
    console.error('Template edit error:', err);
    return NextResponse.json({ error: err.message || 'Template edit failed.' }, { status: 500 });
  }
}
