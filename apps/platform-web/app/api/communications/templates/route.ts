import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
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
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}
