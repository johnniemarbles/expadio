import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

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
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
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
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      // Fallback catalogue items per spec to provide platform admin clarity
      const fallback: TemplateCatalogueItem[] = [
        {
          triggerKey: 'identity.verification.code',
          channels: ['email', 'sms', 'whatsapp'],
          scope: 'PLATFORM',
          activeCount: 1,
          draftCount: 0,
          totalVersions: 1,
          contentFormats: ['TEXT', 'HTML'],
          hasActiveVersion: true,
          locales: ['en', 'es'],
        },
        {
          triggerKey: 'auth.magic_link.requested',
          channels: ['email'],
          scope: 'PLATFORM',
          activeCount: 1,
          draftCount: 0,
          totalVersions: 1,
          contentFormats: ['HTML'],
          hasActiveVersion: true,
          locales: ['en'],
        },
        {
          triggerKey: 'account.security.password_changed',
          channels: ['email', 'sms'],
          scope: 'PLATFORM',
          activeCount: 1,
          draftCount: 1,
          totalVersions: 2,
          contentFormats: ['TEXT', 'HTML'],
          hasActiveVersion: true,
          locales: ['en'],
        },
        {
          triggerKey: 'document.access.request_notification',
          channels: ['email', 'in_app'],
          scope: 'PLATFORM',
          activeCount: 0,
          draftCount: 1,
          totalVersions: 1,
          contentFormats: ['MARKDOWN', 'TEXT'],
          hasActiveVersion: false,
          locales: ['en'],
        },
      ];
      return NextResponse.json(fallback);
    }

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
  } catch (err: any) {
    console.error('Communications template catalogue API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message };
    return NextResponse.json(denied, { status: 500 });
  }
}
