import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNELS = ['email','sms','whatsapp','voice','in_app','push','rcs'] as const;
const FORMATS = ['TEXT','HTML','MARKDOWN'] as const;

export async function GET() {
  try {
    const context = await resolveBrandContext();
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT template_id, version, trigger_key, channel, locale, content_format,
                subject, title, body, required_variables, default_variables, status, updated_at
           FROM platform.communication_templates
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND scope = 'ORGANIZATION'
          ORDER BY trigger_key, channel, locale, version DESC`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json(result.rows.map((row) => ({
        templateId: row.template_id,
        version: row.version,
        triggerKey: row.trigger_key,
        channel: row.channel,
        locale: row.locale,
        contentFormat: row.content_format,
        subject: row.subject,
        title: row.title,
        body: row.body,
        requiredVariables: row.required_variables,
        defaultVariables: row.default_variables,
        status: row.status,
        updatedAt: new Date(row.updated_at).toISOString(),
      })));
    });
  } catch (error) {
    console.error('Brand communication templates read failed:', error);
    return NextResponse.json({ error: 'Unable to load communication templates.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json();
    const triggerKey = typeof body.triggerKey === 'string' ? body.triggerKey.trim() : '';
    const channel = typeof body.channel === 'string' ? body.channel.trim().toLowerCase() : '';
    const locale = typeof body.locale === 'string' && body.locale.trim() ? body.locale.trim() : 'en';
    const contentFormat = typeof body.contentFormat === 'string' ? body.contentFormat.trim().toUpperCase() : '';
    const templateBody = typeof body.body === 'string' ? body.body.trim() : '';
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
    const requiredVariables = Array.isArray(body.requiredVariables)
      ? body.requiredVariables.filter((value: unknown) => typeof value === 'string')
      : [];
    const defaultVariables = body.defaultVariables && typeof body.defaultVariables === 'object' && !Array.isArray(body.defaultVariables)
      ? body.defaultVariables
      : {};

    if (!triggerKey || !templateBody) return NextResponse.json({ error: 'triggerKey and body are required.' }, { status: 400 });
    if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) return NextResponse.json({ error: 'Unsupported channel.' }, { status: 400 });
    if (!FORMATS.includes(contentFormat as (typeof FORMATS)[number])) return NextResponse.json({ error: 'Unsupported content format.' }, { status: 400 });

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' }, { status: 403 });
      }
      const nextVersion = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0)::int + 1 AS version
           FROM platform.communication_templates
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
            AND scope = 'ORGANIZATION' AND trigger_key = $3 AND channel = $4 AND lower(locale) = lower($5)`,
        [context.tenantId, context.organizationId, triggerKey, channel, locale],
      );
      const inserted = await client.query(
        `INSERT INTO platform.communication_templates
          (version, scope, tenant_id, organization_id, trigger_key, channel, locale, content_format,
           subject, title, body, required_variables, default_variables, status)
         VALUES ($1, 'ORGANIZATION', $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'DRAFT')
         RETURNING template_id, version, trigger_key, channel, locale, content_format, subject, title, status, created_at`,
        [nextVersion.rows[0]?.version ?? 1, context.tenantId, context.organizationId, triggerKey, channel, locale,
         contentFormat, subject, title, templateBody, JSON.stringify(requiredVariables), JSON.stringify(defaultVariables)],
      );
      return NextResponse.json({ success: true, template: inserted.rows[0] }, { status: 201 });
    });
  } catch (error) {
    console.error('Brand communication template creation failed:', error);
    return NextResponse.json({ error: 'Unable to create communication template.' }, { status: 500 });
  }
}
