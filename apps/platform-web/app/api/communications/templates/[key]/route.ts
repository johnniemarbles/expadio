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
    if (err.denied) return deniedResponse(err);
    console.error('Template detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
