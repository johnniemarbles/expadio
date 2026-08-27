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
  } catch (err: any) {
    console.error('Template detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
