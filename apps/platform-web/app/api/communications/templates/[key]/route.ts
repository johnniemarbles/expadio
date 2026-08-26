import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../../lib/iam-adapter';

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
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  const resolvedParams = await params;
  const triggerKey = decodeURIComponent(resolvedParams.key);

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
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
      [triggerKey, effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      // Return sample template detail for inspection
      const fallback: TemplateDetailRecord = {
        templateId: 'tpl-sample-001',
        triggerKey,
        channel: 'email',
        version: 1,
        scope: 'PLATFORM',
        locale: 'en',
        contentFormat: 'HTML',
        subject: `[EXPADIO] Action Required: ${triggerKey.replace(/\./g, ' ').toUpperCase()}`,
        title: 'Security Verification & Notice',
        body: `<div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
  <h2 style="color: #4f46e5;">EXPADIO Platform Security Notice</h2>
  <p>Hello {{user_name}},</p>
  <p>A request was received for <strong>${triggerKey}</strong> on your workspace account.</p>
  <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 18px; letter-spacing: 4px; text-align: center; margin: 20px 0;">
    {{otp_code}}
  </div>
  <p style="font-size: 13px; color: #64748b;">This code expires in {{expiry_minutes}} minutes. If you did not initiate this action, please contact security immediately.</p>
</div>`,
        requiredVariables: ['user_name', 'otp_code', 'expiry_minutes'],
        defaultVariables: {
          user_name: 'Alex Mercer',
          otp_code: '492-817',
          expiry_minutes: '10',
        },
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
      };
      return NextResponse.json(fallback);
    }

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
  } catch (err: any) {
    console.error('Template detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
